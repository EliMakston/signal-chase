import { Link } from 'react-router-dom'
import { APP_NAME } from '../../constants'
import { SignalChaseMark } from '../../components/SignalChaseMark'

export default function HomePage() {
  return (
    <main data-theme="radio-terminal" className="radio-game-shell signal-home">
      <SignalChaseMark className="signal-home-mark" />
      <p className="radio-technical-label">Musical Navigation System</p>
      <h1 className="radio-heading">{APP_NAME}</h1>
      <p>Every song is a connection.</p>
      <Link to="/game" className="radio-mechanical-button radio-primary-action signal-play-button">
        Play Signal Chase
        <span aria-hidden="true">→</span>
      </Link>
    </main>
  )
}
