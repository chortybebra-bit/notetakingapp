/** Shown when the page is not a secure context, so browser encryption is unavailable. */
export function InsecureScreen() {
  const host = location.host
  const ipv4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(location.hostname) ? location.hostname : null
  const domain = ipv4 ? `${ipv4.replaceAll('.', '-')}.sslip.io` : 'your.domain'
  return (
    <main className="home">
      <section className="home-card">
        <p className="eyebrow">Encryption unavailable</p>
        <h1>Open Folio securely</h1>
        <p className="lede">
          You opened <strong>{location.protocol}//{host}</strong>. Browsers only allow encryption on{' '}
          <strong>https://</strong>, <strong>.onion</strong>, or <strong>localhost</strong> pages, so
          Folio cannot create keys or open spaces here. Plain http would also let anyone on the network
          tamper with the app.
        </p>
        <h2 className="insecure-heading">Use one of these instead</h2>
        <ol className="insecure-list">
          <li>
            <strong>HTTPS (works in any browser):</strong> in <code>deploy/</code> on the server run{' '}
            <code>DOMAIN={domain} docker compose --profile https up -d --build</code> and open{' '}
            <code>https://{domain}</code>.
            {ipv4 && ' No domain purchase needed: sslip.io names point to the IP inside them.'}
          </li>
          <li>
            <strong>Onion (most anonymous):</strong> run{' '}
            <code>docker compose --profile onion up -d --build</code> and open the <code>.onion</code> address in
            Tor Browser.
          </li>
          <li>
            <strong>SSH tunnel (quick test):</strong> run{' '}
            <code>ssh -L 8080:localhost:{location.port || '80'} user@server</code> and open{' '}
            <code>http://localhost:8080</code>.
          </li>
        </ol>
      </section>
    </main>
  )
}
