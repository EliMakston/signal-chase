import { Link } from 'react-router-dom'
import { SignalChaseMark } from '../components/SignalChaseMark'
import { Seo } from '../components/Seo'
import { APP_NAME } from '../constants'
import { seo } from '../seo'

const instructions = [
  'Start a Demo race and note the destination song.',
  'Choose a recommended song to move through the network.',
  'Reach the destination; backtrack any time to try another route.',
]

export default function Landing() {
  return (
    <>
      <Seo {...seo} path="/" />
      <main
        data-testid="static-landing"
        data-theme="radio-terminal"
        className="radio-game-shell signal-landing"
      >
        <div className="signal-landing-content">
          <header className="signal-landing-header">
            <div className="signal-brand-lockup">
              <SignalChaseMark className="signal-brand-mark" />
              <div>
                <p className="signal-brand-name">{APP_NAME}</p>
                <p className="radio-technical-label">Musical Navigation System</p>
              </div>
            </div>
            <span className="signal-beta-badge">PUBLIC BETA · V0.1.0</span>
          </header>

          <section aria-labelledby="landing-title" className="signal-landing-hero">
            <p className="radio-technical-label">A song-to-song route finder</p>
            <h1 id="landing-title" className="radio-heading signal-landing-title">
              Every song is a connection.
            </h1>
            <p className="signal-landing-intro">
              Follow recommendation links from a starting track to a destination.
              Choose your next song, explore the route, and find your way there.
            </p>
            <Link
              to="/game"
              className="radio-mechanical-button radio-primary-action signal-play-button"
            >
              Play Signal Chase
              <span aria-hidden="true">→</span>
            </Link>
            <p className="signal-live-note" role="note">
              Live music lookup is off for this beta. Demo mode is ready to play.
            </p>
          </section>

          <section
            aria-labelledby="how-to-play-title"
            className="radio-terminal-panel signal-instructions"
          >
            <div className="signal-section-heading">
              <p className="radio-technical-label">Operating instructions</p>
              <h2 id="how-to-play-title" className="radio-heading">
                How to play
              </h2>
            </div>
            <ol className="signal-instruction-list">
              {instructions.map((instruction, index) => (
                <li key={instruction}>
                  <span className="signal-step-number" aria-hidden="true">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <span>{instruction}</span>
                </li>
              ))}
            </ol>
            <p className="signal-backtrack-note">
              Backtracking removes the abandoned branch from your active route,
              so you can keep exploring until you reach the destination.
            </p>
          </section>

          <footer className="signal-landing-footer">
            <p>
              Signal Chase is an independent portfolio project, not affiliated
              with or endorsed by any music streaming service.
            </p>
            <span className="radio-technical-label">DEMO GRAPH · BETA 0.1.0</span>
          </footer>
        </div>
      </main>
    </>
  )
}
