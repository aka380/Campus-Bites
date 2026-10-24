import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch, MagicMock

from agent_demo import crew


class CrewRefactorTests(unittest.TestCase):
    def test_target_path_allowlist_enforcement(self):
        """Only designated paths per actor are authorized; symlinks and traversal are rejected."""
        # Frontend is only allowed site/feature.js
        self.assertEqual(crew.validate_target_path(crew.FRONTEND, "Frontend"), crew.FRONTEND)
        with self.assertRaises(ValueError):
            crew.validate_target_path(crew.BACKEND, "Frontend")
        with self.assertRaises(ValueError):
            crew.validate_target_path(crew.TESTS, "Frontend")

        # Backend is only allowed api/feature.mjs
        self.assertEqual(crew.validate_target_path(crew.BACKEND, "Backend"), crew.BACKEND)
        with self.assertRaises(ValueError):
            crew.validate_target_path(crew.FRONTEND, "Backend")

        # QA is only allowed tests/feature.acceptance.test.mjs
        self.assertEqual(crew.validate_target_path(crew.TESTS, "QA"), crew.TESTS)
        with self.assertRaises(ValueError):
            crew.validate_target_path(crew.ROOT / "tests/feature.contract.test.mjs", "QA")

        # Architect and Manager cannot write source files
        with self.assertRaises(ValueError):
            crew.validate_target_path(crew.FRONTEND, "Architect")
        with self.assertRaises(ValueError):
            crew.validate_target_path(crew.FRONTEND, "Manager")

        # Path traversal outside repository root
        with self.assertRaises(ValueError):
            crew.validate_target_path(Path("/tmp/feature.js"), "Frontend")

    def test_secret_scrubbing(self):
        """Sensitive credentials in text and regex patterns are redacted."""
        # Test Groq key pattern
        text_groq = "Request failed with key gsk_abc1234567890123456789012345"
        self.assertEqual(crew.scrub(text_groq), "Request failed with key [REDACTED]")

        # Test Google API key pattern
        text_gemini = "AIzaSyD1234567890123456789012345678901 failed quota"
        self.assertEqual(crew.scrub(text_gemini), "[REDACTED] failed quota")

        # Test Bearer header pattern
        text_bearer = "Authorization: Bearer mysecrettoken123456789012345"
        self.assertEqual(crew.scrub(text_bearer), "Authorization: Bearer [REDACTED]")

        # Test active environment variable scrubbing
        with patch.dict(os.environ, {"CUSTOM_TEST_KEY": "supersecretkey9988"}):
            self.assertEqual(crew.scrub("Using supersecretkey9988 for auth"), "Using [REDACTED] for auth")

    def test_transient_error_classification(self):
        """Transient errors retry; permanent errors fail immediately."""
        self.assertTrue(crew.is_transient_error(Exception("429 Too Many Requests")))
        self.assertTrue(crew.is_transient_error(Exception("Resource exhausted: quota exceeded")))
        self.assertTrue(crew.is_transient_error(TimeoutError("Gateway timed out")))
        self.assertTrue(crew.is_transient_error(Exception("503 Service Unavailable")))
        self.assertTrue(crew.is_transient_error(Exception("Connection reset by peer")))

        # Permanent errors should not be marked transient
        self.assertFalse(crew.is_transient_error(ValueError("Invalid argument: model not found")))
        self.assertFalse(crew.is_transient_error(Exception("401 Unauthorized: invalid API key")))
        self.assertFalse(crew.is_transient_error(Exception("400 Bad Request")))

    def test_tool_argument_sanitization(self):
        """Tools reject None, non-string, or empty arguments cleanly without exceptions."""
        self.assertIn("REJECTED: content must be provided as a non-empty string",
                      crew.write_code(crew.BACKEND, None, "Backend", ["handle"], crew.CODE_BLOCKED, "API:"))
        self.assertIn("REJECTED: content must be provided as a non-empty string",
                      crew.write_code(crew.BACKEND, "", "Backend", ["handle"], crew.CODE_BLOCKED, "API:"))
        self.assertIn("REJECTED: source_code must be provided as a non-empty string",
                      crew.write_tests(None))
        self.assertIn("REJECTED: source_code must be provided as a non-empty string",
                      crew.write_tests("   "))

    def test_acceptance_tests_rejection_on_module_crash(self):
        """QA tests that crash due to bad imports or module failures are rejected, not accepted."""
        # Code with invalid import not in allowed imports
        bad_import_code = """
import test from 'node:test';
import assert from 'node:assert/strict';
import { nonexistent } from 'some-nonexistent-package';

test('API: test 1', () => { assert.equal(1, 2); });
test('API: test 2', () => { assert.equal(1, 2); });
test('API: test 3', () => { assert.equal(1, 2); });
"""
        res = crew.write_tests(bad_import_code)
        self.assertIn("REJECTED", res)

    def test_atomic_file_save(self):
        """save() performs atomic write, updates counts and patches, and preserves content."""
        temp_dir = tempfile.mkdtemp()
        try:
            target = crew.BACKEND
            original_content = target.read_text(encoding="utf-8")
            # Overwrite with test content
            test_content = "// Test content\nexport function handle() { return {status: 200}; }\n"
            try:
                new_sha = crew.save(target, test_content, "Backend")
                self.assertEqual(new_sha, crew.sha256(test_content))
                self.assertEqual(target.read_text(encoding="utf-8"), test_content)
                self.assertIn("Backend", crew.changed)
            finally:
                # Restore original content
                target.write_text(original_content, encoding="utf-8")
        finally:
            import shutil
            shutil.rmtree(temp_dir, ignore_errors=True)

    def test_summary_persistence_on_preflight_failure(self):
        """summary.json is written even when preflight checks fail due to missing keys."""
        crew.reset_run_state("test-run-preflight")
        # Ensure no keys
        with patch.dict(os.environ, {"GROQ_API_KEY": "", "GEMINI_API_KEY": "", "GOOGLE_API_KEY": ""}, clear=True):
            rc = crew.main()
            self.assertEqual(rc, 2)
            summary_file = crew.RUN_DIR / "summary.json"
            self.assertTrue(summary_file.exists())
            import json
            summary = json.loads(summary_file.read_text(encoding="utf-8"))
            self.assertEqual(summary["status"], "failed")
            self.assertEqual(summary["run_id"], "test-run-preflight")

    def test_tests_rejected_if_pass_without_feature(self):
        """Candidate tests that pass without any feature code must be rejected."""
        valid_code = """
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeView } from './helpers.mjs';

test('UI: dummy test 1', () => { assert.equal(1, 1); });
test('UI: dummy test 2', () => { assert.equal(1, 1); });
test('UI: dummy test 3', () => { assert.equal(1, 1); });
"""
        with patch("agent_demo.crew.execute_tests", return_value=(True, "all pass", {"pass": 3, "fail": 0, "failing": []})):
            res = crew.write_tests(valid_code)
            self.assertIn("REJECTED: these tests already pass with no feature installed", res)

    def test_tests_rejected_on_runtime_import_crash(self):
        """Candidate tests that crash during import must be rejected as harness failures."""
        valid_syntax_code = """
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeView } from './helpers.mjs';

test('UI: broken test 1', () => { assert.equal(1, 2); });
test('UI: broken test 2', () => { assert.equal(1, 2); });
test('UI: broken test 3', () => { assert.equal(1, 2); });
"""
        mock_output = "Error [ERR_MODULE_NOT_FOUND]: Cannot find module './helpers.mjs'"
        mock_summary = {"pass": 0, "fail": 1, "failing": ["tests/feature.acceptance.test.mjs"]}
        with patch("agent_demo.crew.execute_tests", return_value=(False, mock_output, mock_summary)):
            res = crew.write_tests(valid_syntax_code)
            self.assertIn("REJECTED: tests failed due to an import error or module crash", res)

    def test_write_code_respects_max_writes_per_assignment(self):
        """Developer write limit per assignment is enforced."""
        crew.assignment_writes["Backend"] = crew.MAX_WRITES_PER_ASSIGNMENT
        res = crew.write_code(crew.BACKEND, "export function handle() {}", "Backend", ["handle"], crew.CODE_BLOCKED, "API:")
        self.assertIn("REJECTED: write limit reached for this assignment", res)
        crew.assignment_writes["Backend"] = 0

    def test_execute_tests_hardened_invocation(self):
        """execute_tests runs node with V8 limits and returns structured summary."""
        passed, output, summary = crew.execute_tests(["tests/feature.contract.test.mjs"])
        self.assertIsInstance(passed, bool)
        self.assertIsInstance(output, str)
        self.assertIn("pass", summary)
        self.assertIn("fail", summary)
        self.assertIn("failing", summary)
        self.assertEqual(summary["pass"], 2)


if __name__ == "__main__":
    unittest.main()

