// Fake Atlassian server for the Electron tests. One HTTPS server answers as
// four instances, chosen by the Host header (the launcher maps every hostname
// to 127.0.0.1 with --host-resolver-rules):
//   jira.corp.test        Jira Data Center
//   confluence.corp.test  Confluence Data Center (no context path)
//   wiki.corp.test        Confluence Data Center under /wiki
//   acme.atlassian.net    Atlassian Cloud
const https = require('https');
const fs = require('fs');
const path = require('path');

const COOKIES = {
  jira: 'JSESSIONID=jira-session-1',
  confluence: 'JSESSIONID=conf-session-1',
  cloud: 'cloud.session.token=cloud-session-1',
};

function defaultJira() {
  return {
    currentUser: 'admin',
    users: [
      { key: 'JIRAUSER10000', name: 'admin', displayName: 'Admin', emailAddress: 'admin@corp.test', active: true, groups: ['jira-administrators', 'jira-software-users'] },
      { key: 'JIRAUSER10001', name: 'alice', displayName: 'Alice Anderson', emailAddress: 'alice@corp.test', active: true, groups: ['jira-software-users'] },
      { key: 'JIRAUSER10002', name: 'bob', displayName: 'Bob Brown', emailAddress: 'bob@corp.test', active: false, groups: ['Developers'] },
      { key: 'JIRAUSER10003', name: 'carol', displayName: 'Carol Clark', emailAddress: 'carol@corp.test', active: true, groups: [] },
    ],
    groups: ['jira-administrators', 'jira-software-users', 'Developers', 'QA'],
    crowdWildcard: true,          // '%' search returns everyone
    reactivateOnGroupChange: false, // simulate instances that re-enable users on group edits
  };
}

function defaultConfluence() {
  return {
    currentUser: 'admin',
    users: [
      { userKey: 'ck-admin', username: 'admin', displayName: 'Conf Admin', status: 'current', hiddenEmail: 'cadmin@corp.test', groups: ['confluence-administrators', 'confluence-users'] },
      { userKey: 'ck-alice', username: 'alice', displayName: 'Alice Anderson', status: 'current', hiddenEmail: 'alice@corp.test', groups: ['confluence-users'] },
      { userKey: 'ck-dave', username: 'dave', displayName: 'Dave Davis', status: 'deactivated', hiddenEmail: 'dave@corp.test', groups: [] },
    ],
    groups: ['confluence-administrators', 'confluence-users', 'Writers'],
    rpcEnabled: true,
    searchUserEnabled: true,
  };
}

function defaultCloud() {
  return {
    cloudId: 'cloud-123',
    currentUser: 'acc-admin',
    users: [
      { accountId: 'acc-admin', displayName: 'Cloud Admin', emailAddress: 'admin@acme.test', active: true, accountType: 'atlassian', groups: ['site-admins'], products: [{ productKey: 'jira-software', roles: ['product/admin'] }] },
      { accountId: 'acc-alice', displayName: 'Alice Anderson', emailAddress: 'alice@acme.test', active: true, accountType: 'atlassian', groups: ['jira-users'], products: [{ productKey: 'confluence', roles: ['product/member'] }] },
      { accountId: 'acc-bot', displayName: 'Automation for Jira', emailAddress: '', active: true, accountType: 'app', groups: [], products: [] },
      { accountId: 'acc-erin', displayName: 'Erin Evans', emailAddress: 'erin@acme.test', active: false, accountType: 'atlassian', groups: [], products: [] },
    ],
    groups: ['site-admins', 'jira-users', 'confluence-users'],
    siteProducts: [
      { productKey: 'jira-software', productName: 'Jira Software', workspaceName: 'acme', availableRoles: ['product/member', 'product/admin'], userCount: 2 },
      { productKey: 'confluence', workspaceName: 'acme', availableRoles: ['product/member', 'product/admin'], userCount: 1 },
    ],
    applicationRoles: [{ key: 'jira-software', name: 'Jira Software', numberOfSeats: 10 }, { key: 'jira-servicedesk', name: 'Jira Service Management', numberOfSeats: 5 }],
    lifecycleEndpointWorks: true, // first lifecycle endpoint; if false, an HTML page comes back and the next one is used
  };
}

function send(res, status, obj, headers = {}) {
  const isText = typeof obj === 'string';
  const body = Buffer.from(isText ? obj : JSON.stringify(obj));
  res.writeHead(status, { 'Content-Type': isText ? 'text/html' : 'application/json', 'Content-Length': body.length, ...headers });
  res.end(body);
}
const redirect = (res, location, cookie) => {
  res.writeHead(302, { Location: location, ...(cookie ? { 'Set-Cookie': `${cookie}; Path=/; Secure; HttpOnly` } : {}) });
  res.end();
};
const page = title => `<html><head><title>${title}</title></head><body>${title}</body></html>`;
const paged = (arr, start, limit) => arr.slice(start, start + limit);

function createAtlassianMock({ tls = 'allowlisted' } = {}) {
  const state = { jira: defaultJira(), confluence: defaultConfluence(), cloud: defaultCloud() };
  const requests = [];
  const failures = []; // { host?, method?, pathRe, status, body?, headers?, times }
  // Real Atlassian endpoints answer many writes with 204 No Content
  const options = { noContentStatus: 204 };
  const noContent = res => { res.writeHead(options.noContentStatus); res.end(); };

  // ─── Jira DC ────────────────────────────────────────────────
  function jira(req, res, url, body, authed) {
    const J = state.jira;
    const p = url.pathname, q = url.searchParams;
    const findUser = () => J.users.find(u => (q.get('key') && u.key === q.get('key')) || (q.get('username') && u.name === q.get('username')));
    const userJson = (u, expand = '') => {
      const out = { key: u.key, name: u.name, displayName: u.displayName, emailAddress: u.emailAddress, active: u.active };
      if (expand.includes('groups')) out.groups = { size: u.groups.length, items: u.groups.map(name => ({ name })) };
      return out;
    };

    if (p === '/') return redirect(res, authed ? '/secure/Dashboard.jspa' : '/login.jsp');
    if (p === '/login.jsp') return redirect(res, '/secure/Dashboard.jspa', COOKIES.jira);
    if (p === '/secure/Dashboard.jspa') return send(res, 200, page('System Dashboard - Jira'));
    if (p === '/rest/api/2/serverInfo') return send(res, 200, { baseUrl: `https://${req.headers.host}`, version: '9.12.0', serverTitle: 'Corp Jira' });
    if (!authed) return send(res, 401, { errorMessages: ['You are not authenticated.'] });

    if (p === '/rest/api/2/myself') return send(res, 200, userJson(J.users.find(u => u.name === J.currentUser)));
    if (p === '/rest/api/2/user/search') {
      const term = (q.get('username') || '').toLowerCase();
      const start = Number(q.get('startAt') || 0), max = Number(q.get('maxResults') || 50);
      let found;
      if (term === '%') found = J.crowdWildcard ? J.users : [];
      else found = J.users.filter(u => [u.name, u.displayName, u.emailAddress].some(v => v.toLowerCase().includes(term)));
      if (q.get('includeInactive') !== 'true') found = found.filter(u => u.active);
      return send(res, 200, paged(found, start, max).map(u => userJson(u, q.get('expand') || '')));
    }
    if (p === '/rest/api/2/user' && req.method === 'GET') {
      const u = findUser();
      return u ? send(res, 200, userJson(u, q.get('expand') || '')) : send(res, 404, { errorMessages: ['The user does not exist'] });
    }
    if (p === '/rest/api/2/user' && req.method === 'PUT') {
      const u = findUser();
      if (!u) return send(res, 404, { errorMessages: ['The user does not exist'] });
      const upd = JSON.parse(body.toString() || '{}');
      if ('active' in upd) u.active = upd.active;
      if (upd.emailAddress) u.emailAddress = upd.emailAddress;
      if (upd.name) {
        if (J.users.some(o => o !== u && o.name === upd.name)) return send(res, 400, { errors: { username: 'A user with that username already exists.' } });
        u.name = upd.name;
      }
      return send(res, 200, userJson(u));
    }
    if (p === '/rest/api/2/groups/picker') return send(res, 200, { header: `Showing ${J.groups.length}`, total: J.groups.length, groups: J.groups.map(name => ({ name, html: name })) });
    if (p === '/rest/api/2/group/user') {
      const g = q.get('groupname');
      if (!J.groups.includes(g)) return send(res, 404, { errorMessages: [`Specified group does not exist: ${g}`], errors: {} });
      if (req.method === 'POST') {
        const name = JSON.parse(body.toString()).name;
        const u = J.users.find(x => x.name === name);
        if (!u) return send(res, 404, { errorMessages: [`The user does not exist: ${name}`], errors: {} });
        if (u.groups.includes(g)) return send(res, 400, { errorMessages: [`Cannot add user '${name}', user is already a member of '${g}'`], errors: {} });
        u.groups.push(g);
        if (J.reactivateOnGroupChange) u.active = true;
        return send(res, 201, { name: g });
      }
      if (req.method === 'DELETE') {
        const u = J.users.find(x => x.name === q.get('username'));
        if (!u || !u.groups.includes(g)) return send(res, 400, { errorMessages: [`Cannot remove user '${q.get('username')}' from group '${g}' since user is not a member of '${g}'`], errors: {} });
        u.groups = u.groups.filter(x => x !== g);
        if (J.reactivateOnGroupChange) u.active = true;
        res.writeHead(200); return res.end();
      }
    }
    return send(res, 404, { errorMessages: [`mock jira: unhandled ${req.method} ${p}`] });
  }

  // ─── Confluence DC ──────────────────────────────────────────
  function confluence(req, res, url, body, authed, ctx) {
    const C = state.confluence;
    let p = url.pathname;
    const q = url.searchParams;
    if (ctx) {
      if (p === '/' || p === ctx) return redirect(res, `${ctx}/`);
      if (!p.startsWith(ctx + '/')) return send(res, 404, page('Not Found'));
      p = p.slice(ctx.length);
    }
    const userJson = u => ({ type: 'known', username: u.username, userKey: u.userKey, displayName: u.displayName, ...(q.get('expand')?.includes('status') ? { status: u.status } : {}) });
    const byQuery = () => C.users.find(u => (q.get('key') && u.userKey === q.get('key')) || (q.get('username') && u.username === q.get('username')));

    if (p === '/') return redirect(res, authed ? `${ctx}/index.action` : `${ctx}/login.action`);
    if (p === '/login.action') return redirect(res, `${ctx}/index.action`, COOKIES.confluence);
    if (p === '/index.action') return send(res, 200, page('Dashboard - Confluence'));
    if (p === '/rest/api/accessmode') return send(res, 200, '"READ_WRITE"', { 'Content-Type': 'application/json' });
    if (p === '/rest/api/user/current') {
      if (!authed) return send(res, 200, { type: 'anonymous', displayName: 'Anonymous' });
      return send(res, 200, userJson(C.users.find(u => u.username === C.currentUser)));
    }
    if (!authed) return send(res, 401, { statusCode: 401, message: 'This resource requires authentication' });

    if (p === '/rest/api/space') return send(res, 200, { results: [{ key: 'DOC', name: 'Docs' }], size: 1 });
    if (p === '/rest/api/user/list') {
      const start = Number(q.get('start') || 0), limit = Number(q.get('limit') || 200);
      return send(res, 200, { results: paged(C.users, start, limit).map(userJson), start, limit });
    }
    if (p === '/rest/api/search/user') {
      if (!C.searchUserEnabled) return send(res, 404, { message: 'not found' });
      const terms = [...(q.get('cql') || '').matchAll(/~ "([^"]*)"/g)].map(m => m[1].toLowerCase());
      const found = C.users.filter(u => terms.some(t => u.displayName.toLowerCase().includes(t) || u.hiddenEmail.toLowerCase().includes(t)));
      return send(res, 200, { results: found.map(u => ({ user: userJson(u) })) });
    }
    if (p === '/rest/api/user') {
      const u = byQuery();
      return u ? send(res, 200, userJson(u)) : send(res, 404, { statusCode: 404, message: 'No user found' });
    }
    if (p === '/rest/api/user/memberof') {
      const u = byQuery();
      return u ? send(res, 200, { results: u.groups.map(name => ({ type: 'group', name })) }) : send(res, 404, { message: 'No user found' });
    }
    if (p === '/rest/api/group' && req.method === 'GET') {
      const start = Number(q.get('start') || 0), limit = Number(q.get('limit') || 200);
      return send(res, 200, { results: paged(C.groups, start, limit).map(name => ({ type: 'group', name })) });
    }
    if (p.startsWith('/rest/mobile/1.0/profile/')) {
      const u = C.users.find(x => x.username === decodeURIComponent(p.split('/').pop()));
      return u ? send(res, 200, { username: u.username, fullName: u.displayName, email: u.hiddenEmail }) : send(res, 404, {});
    }
    let m;
    if ((m = p.match(/^\/rpc\/json-rpc\/confluenceservice-v2\/(\w+)$/)) && req.method === 'POST') {
      if (!C.rpcEnabled) return send(res, 403, { message: 'JSON-RPC disabled' });
      const params = JSON.parse(body.toString());
      const user = n => C.users.find(u => u.username === n);
      const fail = msg => send(res, 200, { error: { code: 500, message: msg } });
      switch (m[1]) {
        case 'addUserToGroup': {
          const [n, g] = params;
          if (!C.groups.includes(g)) return fail(`Group ${g} does not exist`);
          if (!user(n)) return fail(`User ${n} does not exist`);
          if (!user(n).groups.includes(g)) user(n).groups.push(g);
          return send(res, 200, 'true', { 'Content-Type': 'application/json' });
        }
        case 'removeUserFromGroup': {
          const [n, g] = params;
          if (!user(n)) return fail(`User ${n} does not exist`);
          user(n).groups = user(n).groups.filter(x => x !== g);
          return send(res, 200, 'true', { 'Content-Type': 'application/json' });
        }
        case 'reactivateUser': case 'deactivateUser': {
          if (!user(params[0])) return fail('no such user');
          user(params[0]).status = m[1] === 'reactivateUser' ? 'current' : 'deactivated';
          res.writeHead(200); return res.end(); // void method, empty body
        }
        case 'editUser': {
          const u = user(params[0].name);
          if (!u) return fail('no such user');
          u.hiddenEmail = params[0].email;
          u.displayName = params[0].fullname;
          return send(res, 200, 'true', { 'Content-Type': 'application/json' });
        }
        case 'renameUser': {
          const [from, to] = params;
          if (!user(from)) return fail('no such user');
          if (user(to)) return fail('Target username already exists');
          user(from).username = to;
          return send(res, 200, 'true', { 'Content-Type': 'application/json' });
        }
        case 'getUserByName': case 'getUser': {
          const u = user(params[0]);
          return u ? send(res, 200, { name: u.username, fullname: u.displayName, email: u.hiddenEmail }) : fail('no such user');
        }
      }
      return fail(`unknown method ${m[1]}`);
    }
    // REST fallbacks used when JSON-RPC is unavailable
    if (p === '/rest/api/group/user') {
      const g = q.get('groupName');
      if (req.method === 'POST') {
        const u = C.users.find(x => x.username === JSON.parse(body.toString()).name);
        if (!u || !C.groups.includes(g)) return send(res, 404, { message: 'not found' });
        if (!u.groups.includes(g)) u.groups.push(g);
        return noContent(res);
      }
      if (req.method === 'DELETE') {
        const u = C.users.find(x => x.username === q.get('username'));
        if (!u) return send(res, 404, { message: 'not found' });
        u.groups = u.groups.filter(x => x !== g);
        return noContent(res);
      }
    }
    if ((m = p.match(/^\/rest\/api\/admin\/user\/(enable|disable)$/)) && req.method === 'PUT') {
      const u = C.users.find(x => x.userKey === q.get('key'));
      if (!u) return send(res, 404, { message: 'not found' });
      u.status = m[1] === 'enable' ? 'current' : 'deactivated';
      return noContent(res);
    }
    return send(res, 404, { message: `mock confluence: unhandled ${req.method} ${p}` });
  }

  // ─── Cloud ──────────────────────────────────────────────────
  function cloud(req, res, url, body, authed) {
    const K = state.cloud;
    const p = url.pathname, q = url.searchParams;
    const userJson = u => ({ accountId: u.accountId, accountType: u.accountType, displayName: u.displayName, emailAddress: u.emailAddress, active: u.active });
    const byId = id => K.users.find(u => u.accountId === id);
    const productName = key => K.siteProducts.find(sp => sp.productKey === key) || { productKey: key };

    if (p === '/') return redirect(res, authed ? '/jira/your-work' : '/login');
    if (p === '/login') return redirect(res, '/jira/your-work', COOKIES.cloud);
    if (p === '/jira/your-work') return send(res, 200, page('Your work - Jira'));
    if (!authed) return send(res, 401, { message: 'Client must be authenticated to access this resource.' });

    if (p === '/_edge/tenant_info') return send(res, 200, { cloudId: K.cloudId });
    if (p === '/rest/api/3/myself') return send(res, 200, userJson(byId(K.currentUser)));
    if (p === '/rest/api/3/users/search') {
      const start = Number(q.get('startAt') || 0), max = Number(q.get('maxResults') || 50);
      return send(res, 200, paged(K.users, start, max).map(userJson));
    }
    if (p === '/rest/api/3/user/search') {
      const term = (q.get('query') || '').toLowerCase();
      return send(res, 200, K.users.filter(u => [u.displayName, u.emailAddress, u.accountId].some(v => v.toLowerCase().includes(term))).map(userJson));
    }
    if (p === '/rest/api/3/user' && req.method === 'GET') {
      const u = byId(q.get('accountId'));
      if (!u) return send(res, 404, { errorMessages: ['Specified user does not exist or you do not have required permissions'] });
      const out = userJson(u);
      if (q.get('expand') === 'applicationRoles') out.applicationRoles = { items: u.products.map(pr => ({ key: pr.productKey, name: pr.productKey })) };
      return send(res, 200, out);
    }
    if (p === '/rest/api/3/user' && req.method === 'PUT') {
      const u = byId(q.get('accountId'));
      if (!u) return send(res, 404, { errorMessages: ['no user'] });
      const upd = JSON.parse(body.toString());
      if (upd.emailAddress) u.emailAddress = upd.emailAddress;
      return send(res, 200, userJson(u));
    }
    if (p === '/rest/api/3/group/bulk') {
      const start = Number(q.get('startAt') || 0), max = Number(q.get('maxResults') || 50);
      const values = paged(K.groups, start, max).map((name, i) => ({ name, groupId: `g-${start + i}` }));
      return send(res, 200, { startAt: start, maxResults: max, total: K.groups.length, isLast: start + max >= K.groups.length, values });
    }
    if (p === '/rest/api/3/user/groups') {
      const u = byId(q.get('accountId'));
      return u ? send(res, 200, u.groups.map(name => ({ name }))) : send(res, 404, { errorMessages: ['no user'] });
    }
    if (p === '/rest/api/3/group/user') {
      const g = q.get('groupname');
      if (!K.groups.includes(g)) return send(res, 404, { errorMessages: [`Group ${g} does not exist.`], errors: {} });
      if (req.method === 'POST') {
        const u = byId(JSON.parse(body.toString()).accountId);
        if (u.groups.includes(g)) return send(res, 400, { errorMessages: [`Cannot add user. User is already a member of '${g}'`], errors: {} });
        u.groups.push(g);
        return send(res, 201, { name: g });
      }
      if (req.method === 'DELETE') {
        const u = byId(q.get('accountId'));
        u.groups = u.groups.filter(x => x !== g);
        res.writeHead(200); return res.end();
      }
    }
    if (p === '/rest/api/3/applicationrole') return send(res, 200, K.applicationRoles);
    let m;
    if ((m = p.match(/^\/gateway\/api\/adminhub\/um\/site\/([^/]+)\/products$/))) {
      if (m[1] !== K.cloudId) return send(res, 404, {});
      return send(res, 200, { products: K.siteProducts });
    }
    if ((m = p.match(/^\/gateway\/api\/adminhub\/um\/site\/([^/]+)\/users\/([^/]+)\/products$/))) {
      const u = byId(m[2]);
      if (!u) return send(res, 404, {});
      return send(res, 200, u.products.map(pr => ({ ...productName(pr.productKey), roles: pr.roles })));
    }
    if ((m = p.match(/^\/gateway\/api\/adminhub\/um\/site\/([^/]+)\/users\/([^/]+)\/products\/([^/]+)\/access$/))) {
      const u = byId(m[2]);
      const key = decodeURIComponent(m[3]);
      if (!u || !K.siteProducts.some(sp => sp.productKey === key)) return send(res, 404, { message: 'unknown product' });
      if (req.method === 'PUT') {
        const roles = JSON.parse(body.toString()).roles;
        const existing = u.products.find(pr => pr.productKey === key);
        if (existing) existing.roles = [...new Set([...existing.roles, ...roles])];
        else u.products.push({ productKey: key, roles });
        return send(res, 200, {});
      }
      if (req.method === 'DELETE') {
        u.products = u.products.filter(pr => pr.productKey !== key);
        return noContent(res);
      }
    }
    if ((m = p.match(/^\/gateway\/api\/adminhub\/um\/user\/([^/]+)\/manage\/lifecycle\/(enable|disable)$/)) && req.method === 'POST') {
      if (!K.lifecycleEndpointWorks) return send(res, 200, '<!DOCTYPE html><html><body>Sign in</body></html>');
      const u = byId(m[1]);
      if (!u) return send(res, 404, {});
      u.active = m[2] === 'enable';
      return noContent(res);
    }
    if ((m = p.match(/^\/gateway\/api\/directory\/v1\/user\/([^/]+)\/lifecycle\/(enable|disable)$/)) && req.method === 'POST') {
      const u = byId(m[1]);
      if (!u) return send(res, 404, {});
      u.active = m[2] === 'enable';
      return noContent(res);
    }
    return send(res, 404, { errorMessages: [`mock cloud: unhandled ${req.method} ${p}`] });
  }

  function handler(req, res) {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const host = (req.headers.host || '').split(':')[0];
      const url = new URL(req.url, `https://${req.headers.host}`);
      requests.push({ method: req.method, host, url: req.url, path: url.pathname, headers: req.headers, body });

      const fi = failures.findIndex(f => (!f.host || f.host === host) && (!f.method || f.method === req.method) && f.pathRe.test(req.url));
      if (fi !== -1) {
        const f = failures[fi];
        if (--f.times <= 0) failures.splice(fi, 1);
        return send(res, f.status, f.body ?? { errorMessages: [`injected ${f.status}`] }, f.headers);
      }

      const cookie = req.headers.cookie || '';
      const has = c => cookie.split(/;\s*/).includes(c);
      if (host === 'jira.corp.test') return jira(req, res, url, body, has(COOKIES.jira));
      if (host === 'confluence.corp.test') return confluence(req, res, url, body, has(COOKIES.confluence), '');
      if (host === 'wiki.corp.test') return confluence(req, res, url, body, has(COOKIES.confluence), '/wiki');
      if (host.endsWith('.atlassian.net')) return cloud(req, res, url, body, has(COOKIES.cloud));
      return send(res, 404, page(`Unknown host ${host}`));
    });
  }

  const cert = tls === 'self-signed' ? 'self-signed' : 'allowlisted';
  const server = https.createServer({
    key: fs.readFileSync(path.join(__dirname, '..', 'fixtures', `${cert}.key`)),
    cert: fs.readFileSync(path.join(__dirname, '..', 'fixtures', `${cert}.crt`)),
  }, handler);

  return new Promise(resolve => server.listen(0, '127.0.0.1', () => {
    const port = server.address().port;
    resolve({
      port,
      state,
      options,
      requests,
      failures,
      url: host => `https://${host}:${port}`,
      jiraUser: name => state.jira.users.find(u => u.name === name),
      confUser: name => state.confluence.users.find(u => u.username === name),
      cloudUser: id => state.cloud.users.find(u => u.accountId === id),
      close: () => new Promise(r => { server.closeAllConnections?.(); server.close(r); }),
    });
  }));
}

module.exports = { createAtlassianMock, COOKIES };
