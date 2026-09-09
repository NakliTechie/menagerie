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
// reWS is the whitespace class used inside the patterns, spelled out so Go and
// JavaScript match the same set. Go's \s is [\t\n\f\r ]; JavaScript's is all
// 25 ECMAScript whitespace code points.
const reWS = "\\t\\n\\v\\f\\r \\x{0085}\\x{00a0}\\x{1680}\\x{2000}-\\x{200a}\\x{2028}\\x{2029}\\x{202f}\\x{205f}\\x{3000}\\x{feff}"

var secretPatterns = []struct {
	code string
	what string
	re   *regexp.Regexp
}{
	{"aws_access_key", "an AWS access key id", regexp.MustCompile(`\bAKIA[0-9A-Z]{16}\b`)},
	{"openai_key", "an OpenAI-style API key", regexp.MustCompile(`\bsk-[A-Za-z0-9_-]{16,}\b`)},
	{"github_token", "a GitHub token", regexp.MustCompile(`\bghp_[A-Za-z0-9]{20,}\b`)},
	// The password half allows ":" (postgres://user:pw:x@host is a real DSN) but
	// never "/": per RFC 3986 the authority ends at the first "/", so a userinfo
	// password cannot contain one. Allowing it made host:port/path satisfy
	// user:password and match on to any later "@", so
	// https://api.example.com:8443/health?who=me@example.com was refused as a
	// credential and its spec could not be launched at all.
	//
	// The whitespace class is spelled out rather than written \s, because Go's RE2
	// \s is 5 code points and JavaScript's is 25 — the mirror would diverge.
	{"inline_db_credentials", "inline database credentials", regexp.MustCompile(`\b[a-zA-Z][a-zA-Z0-9+.-]*://[^` + reWS + `/@"]+:[^` + reWS + `/@"]+@`)},
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

// LintSecretsDecoded re-runs the patterns over the document's DECODED string
// values, so an escaped credential is caught in the form it will actually take.
// Issues carry "/#decoded" rather than a line number: after decoding there are no
// lines.
//
// It walks the values rather than re-serialising them. Re-encoding made the result
// depend on each language's escaping rules — Go writes U+2028 raw where
// JavaScript's JSON.stringify must escape it — so the same document was judged
// differently by the relay and the browser.
func LintSecretsDecoded(b []byte) []Issue {
	// UseNumber keeps numbers as text. Without it, decoding into `any` sends every
	// number through ParseFloat, so one out-of-range literal like 1e999 errored and
	// silently disabled the entire pass, defeating exactly the escaped credentials
	// it exists to catch.
	dec := json.NewDecoder(bytes.NewReader(b))
	dec.UseNumber()
	var generic any
	if err := dec.Decode(&generic); err != nil {
		if !json.Valid(b) {
			return nil // unparseable: the raw pass is the only one that applies
		}
		// A lint that could not run is never a lint that passed.
		return []Issue{{Path: "/#decoded", Code: "secret_lint_incomplete",
			Message: "the document could not be decoded for the secret lint, so it was not fully checked: " + err.Error()}}
	}

	var out []Issue
	seen := map[string]bool{}
	walkStrings(generic, func(v string) {
		for _, p := range secretPatterns {
			if p.re.MatchString(v) && !seen[p.code] {
				seen[p.code] = true
				out = append(out, Issue{
					Path: "/#decoded",
					Code: "secret_in_spec",
					Message: "the document decodes to something that looks like " + p.what +
						"; escaping it does not make it safe to commit (D4)",
				})
			}
		}
	})
	return out
}

// walkStrings visits every string value in a decoded JSON document, including
// object keys — a credential is no safer for being used as a key.
func walkStrings(v any, fn func(string)) {
	switch t := v.(type) {
	case string:
		fn(t)
	case json.Number:
		fn(t.String())
	case map[string]any:
		for k, val := range t {
			fn(k)
			walkStrings(val, fn)
		}
	case []any:
		for _, val := range t {
			walkStrings(val, fn)
		}
	}
}
