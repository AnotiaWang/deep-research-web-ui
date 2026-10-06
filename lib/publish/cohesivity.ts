/**
 * Cohesivity publish flow — browser-side.
 *
 * Creates an ephemeral tenant via POST /api/genesis, provisions
 * railway-hosting, deploys the report as a static page, and returns
 * a <tenant>.cohesivity.app URL + claim link.
 * No account or API keys required.
 */

const API = 'https://cohesivity.ai'
const MACHINE_ID_KEY = 'cohesivity:machine-id'

interface Tenant {
  tenantId: string
  managementKey: string
  applicationKey: string
  expiresAt: string
  runtimeProfile: string
}

export interface PublishResult {
  url: string
  claimUrl: string
  tenantId: string
  managementKey: string
  applicationKey: string
  expiresAt: string
  runtimeProfile: string
}

export type PublishStep =
  | 'creating'
  | 'provisioning'
  | 'deploying'
  | 'claiming'
  | 'done'

function parseTenantResponse(text: string): Tenant {
  const kv: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq > 0) kv[t.slice(0, eq).trim()] = t.slice(eq + 1).trim()
  }
  if (!kv.tenant_id || !kv.coh_management_key || !kv.coh_application_key)
    throw new Error('Incomplete credentials from tenant creation')
  return {
    tenantId: kv.tenant_id,
    managementKey: kv.coh_management_key,
    applicationKey: kv.coh_application_key,
    expiresAt: kv.expires_at || '',
    runtimeProfile: kv.runtime_profile || '',
  }
}

async function createTenant(): Promise<Tenant> {
  const headers: Record<string, string> = {}
  const mid = localStorage.getItem(MACHINE_ID_KEY)
  if (mid) headers['X-Cohesivity-Machine-Id'] = mid

  const res = await fetch(`${API}/api/genesis`, { method: 'POST', headers })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Tenant creation failed: HTTP ${res.status} ${body.slice(0, 200)}`)
  }

  const newMid = res.headers.get('X-Cohesivity-Machine-Id')
  if (newMid) try { localStorage.setItem(MACHINE_ID_KEY, newMid.trim()) } catch {}

  return parseTenantResponse(await res.text())
}

async function apiPost(path: string, key: string, body?: unknown): Promise<Response> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${key}`,
  }
  const init: RequestInit = { method: 'POST', headers }
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
    init.body = JSON.stringify(body)
  }
  const res = await fetch(`${API}${path}`, init)
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`${path} failed: HTTP ${res.status} ${text.slice(0, 200)}`)
  }
  return res
}

function escapeHtml(s: string): string {
  return s.replace(/[<>&"]/g, (c) =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c] || c,
  )
}

function buildDeployFiles(reportHtml: string, title: string) {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
body{max-width:48rem;margin:2rem auto;padding:0 1rem;font-family:system-ui,-apple-system,sans-serif;line-height:1.6;color:#1a1a1a}
h1{font-size:1.8rem;margin-bottom:.5rem}h2{font-size:1.4rem;margin-top:2rem}h3{font-size:1.15rem;margin-top:1.5rem}
a{color:#2563eb}blockquote{border-left:3px solid #d1d5db;margin-left:0;padding-left:1rem;color:#4b5563}
code{background:#f3f4f6;padding:.15rem .3rem;border-radius:3px;font-size:.9em}
pre{background:#f3f4f6;padding:1rem;border-radius:6px;overflow-x:auto}pre code{background:none;padding:0}
table{border-collapse:collapse;width:100%;margin:1rem 0}th,td{border:1px solid #d1d5db;padding:.5rem .75rem;text-align:left}
th{background:#f9fafb;font-weight:600}
.footer{margin-top:3rem;padding-top:1rem;border-top:1px solid #e5e7eb;font-size:.85rem;color:#6b7280}
</style>
</head>
<body>
${reportHtml}
<div class="footer">Published with <a href="https://cohesivity.ai?ref=gh-deep-research-web-ui">Cohesivity</a></div>
</body>
</html>`

  const server = `const http=require("http"),fs=require("fs");
const h=fs.readFileSync("index.html","utf-8");
http.createServer((_,r)=>{r.writeHead(200,{"Content-Type":"text/html"});r.end(h)}).listen(process.env.PORT||3000);`

  return [
    { file: 'index.html', data: html },
    { file: 'server.js', data: server },
    { file: 'package.json', data: '{"name":"report","scripts":{"start":"node server.js"}}' },
  ]
}

export function buildAgentPrompt(tenant: Tenant): string {
  return `This is a research artifact hosted on cohesivity.ai.

Cohesivity is on-the-fly backend infrastructure for AI agents. Read https://cohesivity.ai/llms.txt for the full reference.

Tenant: ${tenant.tenantId}
Management key: ${tenant.managementKey}
Application key: ${tenant.applicationKey}
Runtime: ${tenant.runtimeProfile}

Help me manage this project. You can check its status, provision additional services, set up a custom domain, or claim it to keep it permanently.

Status: GET ${API}/api/status (Authorization: Bearer <management_key>)
Provision: POST ${API}/api/resources/<name> (Authorization: Bearer <management_key>)
Docs: ${API}/llms.txt`
}

export async function publishReport(
  reportHtml: string,
  query: string,
  onStep?: (step: PublishStep) => void,
): Promise<PublishResult> {
  onStep?.('creating')
  const tenant = await createTenant()

  onStep?.('provisioning')
  const provRes = await apiPost('/api/resources/railway-hosting', tenant.managementKey)
  const provData = await provRes.json()
  const deploymentUrl: string = provData.deployment_url || ''

  onStep?.('deploying')
  const files = buildDeployFiles(reportHtml, query || 'Research Report')
  const deployRes = await apiPost(
    '/api/railway/deploy?wait=ready',
    tenant.managementKey,
    { files },
  )
  const deployData = await deployRes.json()
  const url = deployData.deployment_url || deploymentUrl

  onStep?.('claiming')
  const claimRes = await apiPost('/api/claim/url', tenant.managementKey)
  const claimData = await claimRes.json()
  const claimUrl = claimData.approval_url || ''

  onStep?.('done')
  return {
    url: url.startsWith('http') ? url : `https://${url}`,
    claimUrl: claimUrl ? `${claimUrl}?ref=gh-deep-research-web-ui` : '',
    tenantId: tenant.tenantId,
    managementKey: tenant.managementKey,
    applicationKey: tenant.applicationKey,
    expiresAt: tenant.expiresAt,
    runtimeProfile: tenant.runtimeProfile,
  }
}
