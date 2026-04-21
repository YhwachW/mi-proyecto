// ─── STATE GLOBAL ────────────────────────────────────────────
// Variables compartidas por todos los módulos. Se mutan directamente
// desde auth.ts al momento del login / logout.

export let currentModule     = 'all';
export let companyIdContext:   string | null = null;
export let companyNameContext: string | null = null;
export let fiscalContext:      Record<string, string> | null = null;
export let authTokenContext:   string | null = null;

export function setCurrentModule(v: string)                  { currentModule    = v; }
export function setCompanyId(v: string | null)               { companyIdContext  = v; }
export function setCompanyName(v: string | null)             { companyNameContext = v; }
export function setFiscalContext(v: Record<string,string>|null) { fiscalContext  = v; }
export function setAuthToken(v: string | null)               { authTokenContext  = v; }
