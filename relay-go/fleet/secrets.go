package fleet

import (
	"bytes"
	"encoding/json"
	"fmt"
	"regexp"
)

// Secrets are referenced, never stored (D4): the spec is committed to the repo,
// so a value that looks like a credential is a validation failure, not a
// warning. Values resolve at materialise time from a source the user controls —
// an environment variable on the relay's own box.
//
// Each pattern is deliberately shaped like the credential it catches rather than
// like "anything long and random", so a legitimate opaque string (a cache key, a
// hash) does not trip it.
var secretPatterns = []struct {
	code string
	what string
	re   *regexp.Regexp
}{
	{"aws_access_key", "an AWS access key id", regexp.MustCompile(`\bAKIA[0-9A-Z]{16}\b`)},
	{"openai_key", "an OpenAI-style API key", regexp.MustCompile(`\bsk-[A-Za-z0-9_-]{16,}\b`)},
	{"github_token", "a GitHub token", regexp.MustCompile(`\bghp_[A-Za-z0-9]{20,}\b`)},
	// The password half deliberately allows "/" and ":": excluding them let
	// postgres://user:pw/x@host and postgres://user:pw:x@host through, and a
	// generated password contains punctuation more often than not.
	{"inline_db_credentials", "inline database credentials", regexp.MustCompile(`\b[a-zA-Z][a-zA-Z0-9+.-]*://[^\s/@"]+:[^\s@"]+@`)},
}

// LintSecrets reports credential-shaped strings anywhere in the raw document.
// It runs on bytes rather than on the parsed Spec so that a credential in a
// field this version does not model is still caught.
//
// Raw bytes alone are not enough: JSON escapes defeat every pattern here. A run
// string written with \u escapes, or the escaped solidus several serialisers
// emit by default (postgres:\/\/user:pw@host), sails past a byte-level match
// while decoding to exactly the credential the pattern describes. So
// LintSecretsDecoded re-checks the decoded document, and ValidateBytes runs both.
func LintSecrets(b []byte) []Issue {
	var out []Issue
	// bytes.Split, not bufio.Scanner: the scanner has a token cap, and a line over
	// it ended the loop as though the document were fully read — so a credential
	// on or after an over-long line was silently missed and the spec passed. A
	// lint that cannot finish must never look like a lint that passed.
	for i, lineBytes := range bytes.Split(b, []byte("\n")) {
		line := i + 1
		text := string(lineBytes)
		for _, p := range secretPatterns {
			if p.re.MatchString(text) {
				out = append(out, Issue{
					Path: fmt.Sprintf("/#line=%d", line),
					Code: "secret_in_spec",
					Message: "line " + fmt.Sprint(line) + " looks like " + p.what +
						"; the spec is committed, so secrets are referenced, never stored (D4) — " +
						"resolve it at materialise time from an environment variable on the relay's box",
				})
			}
		}
	}
	return out
}

// LintSecretsDecoded re-runs the patterns over the document's DECODED strings, so
// an escaped credential is caught in the form it will actually take. Issues carry
// "/#decoded" rather than a line number: after decoding there are no lines.
func LintSecretsDecoded(b []byte) []Issue {
	var generic any
	if err := json.Unmarshal(b, &generic); err != nil {
		return nil // unparseable: the raw pass is the only one that applies
	}
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false) // else < > & become \u escapes and hide a match
	if err := enc.Encode(generic); err != nil {
		return nil
	}
	var out []Issue
	for _, p := range secretPatterns {
		if p.re.Match(buf.Bytes()) {
			out = append(out, Issue{
				Path: "/#decoded",
				Code: "secret_in_spec",
				Message: "the document decodes to something that looks like " + p.what +
					"; escaping it does not make it safe to commit (D4)",
			})
		}
	}
	return out
}
