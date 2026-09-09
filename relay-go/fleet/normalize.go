package fleet

import "strings"

// normalize trims every declared string in the spec, once, at the ingress.
//
// This exists because trimming in the validator alone was actively harmful: the
// validator accepted `"probe": "http "` while the engine still dispatched on the
// raw value, fell through to the command branch, ran `sh -c ""`, and recorded the
// workspace `ready` with the health check never performed. A validator that is
// more permissive than its consumer is worse than one that is stricter.
//
// So there is exactly one place a value is cleaned, and every consumer —
// validator, engine, and the client mirror — sees the same bytes by
// construction. Adding a field to the spec means adding it here.
func (s *Spec) normalize() {
	t := trim
	s.Spec, s.Name, s.Repo, s.Topology = t(s.Spec), t(s.Name), t(s.Repo), t(s.Topology)

	w := &s.Workspace
	w.Isolation, w.BranchPrefix = t(w.Isolation), t(w.BranchPrefix)

	m := &w.Materialise
	m.Escape = t(m.Escape)
	for i := range m.Ports {
		m.Ports[i].Name = t(m.Ports[i].Name)
	}
	for i := range m.Files {
		f := &m.Files[i]
		f.From, f.Template, f.To = t(f.From), t(f.Template), t(f.To)
		for j := range f.Vars {
			f.Vars[j] = t(f.Vars[j])
		}
	}
	for i := range m.Commands {
		m.Commands[i].Run, m.Commands[i].CacheKey = t(m.Commands[i].Run), t(m.Commands[i].CacheKey)
	}
	for i := range m.Services {
		sv := &m.Services[i]
		sv.Name, sv.Run, sv.PortVar = t(sv.Name), t(sv.Run), t(sv.PortVar)
	}
	for i := range m.Health {
		p := &m.Health[i]
		p.Probe, p.URL, p.Run = t(p.Probe), t(p.URL), t(p.Run)
	}
	if m.Hooks != nil {
		m.Hooks.OnStart = t(m.Hooks.OnStart)
		m.Hooks.OnStop = t(m.Hooks.OnStop)
		m.Hooks.OnDestroy = t(m.Hooks.OnDestroy)
	}
	if w.Teardown != nil {
		for i := range w.Teardown.Commands {
			w.Teardown.Commands[i] = t(w.Teardown.Commands[i])
		}
	}
	for i := range s.Roster {
		r := &s.Roster[i]
		r.Role, r.Agent, r.Model = t(r.Role), t(r.Agent), t(r.Model)
	}
	if s.Budgets != nil {
		s.Budgets.OnExceed = t(s.Budgets.OnExceed)
	}
	if s.Exits != nil {
		for i := range s.Exits.ConvergeOn {
			s.Exits.ConvergeOn[i] = t(s.Exits.ConvergeOn[i])
		}
	}
}

// Whitespace is the ECMAScript WhiteSpace + LineTerminator set, plus U+0085.
//
// Neither language's default is authoritative and they disagree: Go's
// unicode.IsSpace trims U+0085 and not U+FEFF, JavaScript's String.trim does the
// opposite. Left to defaults, the relay and the browser judged the same document
// differently — the exact split normalisation exists to prevent. So the set is
// written out here and mirrored character-for-character in index.html.
const Whitespace = "\t\n\v\f\r \u0085\u00a0\u1680" +
	"\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a" +
	"\u2028\u2029\u202f\u205f\u3000\ufeff"

// trim is the only trimmer this package uses.
func trim(s string) string { return strings.Trim(s, Whitespace) }
