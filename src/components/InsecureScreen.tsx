/** Shown when the page is not a secure context, so browser encryption is unavailable. */
export function InsecureScreen() {
  const host = location.host
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
            <strong>Onion (most anonymous):</strong> on the server run{' '}
            <code>docker compose --profile onion up -d</code> and open the <code>.onion</code> address in Tor
            Browser.
          </li>
          <li>
            <strong>SSH tunnel (quickest):</strong> run <code>ssh -L 8080:localhost:{location.port || '80'} user@server</code>{' '}
            and open <code>http://localhost:8080</code>.
          </li>
          <li>
            <strong>HTTPS:</strong> point a domain at the server and run{' '}
            <code>DOMAIN=your.domain docker compose --profile https up -d</code>.
          </li>
        </ol>
      </section>
    </main>
  )
}
