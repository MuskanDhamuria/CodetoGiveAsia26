import { useState } from "react"
import { loginVolunteer, setVolunteerToken } from "./volunteer-api"
import { AccountHeader } from "./VolunteerRegister"

export default function VolunteerLogin({ onLoggedIn, onRegister }: { onLoggedIn: () => void; onRegister: () => void }) {
  const [countryCode, setCountryCode] = useState("+65")
  const [phone, setPhone] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      const result = await loginVolunteer({ contact_number: `${countryCode}${phone.replace(/\D/g, "")}`, password })
      setVolunteerToken(result.access_token)
      onLoggedIn()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not sign you in.")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="pts-account-page">
      <AccountHeader label="Volunteer sign in" onRegister={onRegister} />
      <section className="pts-account-hero pts-account-hero-compact"><p>Welcome back</p><h1>Continue serving with us</h1><span>Sign in to see your event sign-ups and volunteer history.</span></section>
      <main className="pts-account-main">
        <div className="pts-account-side-copy pts-login-side-copy">
          <p className="pts-account-eyebrow">Welcome back</p>
          <h2>Your next good thing starts here.</h2>
          <p>View your event requests and return to the public events page whenever you are ready to join another one.</p>
          <a className="pts-change-event" href="?page=community">Browse events</a>
        </div>
        <form className="pts-account-card" onSubmit={handleSubmit}>
          <div className="pts-account-card-heading"><p className="pts-account-eyebrow">Volunteer account</p><h2>Sign in</h2></div>
          <label className="pts-field"><span>Phone number</span><div className="pts-phone-row"><select aria-label="Country code" value={countryCode} onChange={(event) => setCountryCode(event.target.value)}><option value="+65">SG +65</option><option value="+60">MY +60</option><option value="+62">ID +62</option><option value="+63">PH +63</option><option value="+91">IN +91</option><option value="+880">BD +880</option><option value="+95">MM +95</option><option value="+86">CN +86</option><option value="+84">VN +84</option><option value="+1">US/CA +1</option><option value="+44">UK +44</option></select><input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="8123 4567" inputMode="tel" /></div></label>
          <label className="pts-field"><span>Password</span><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Your password" /></label>
          {error && <p className="pts-signup-error">{error}</p>}
          <button className="pts-signup-submit" type="submit" disabled={submitting}>{submitting ? "Signing in…" : "Sign in"}</button>
          <p className="pts-account-switch">New here? <button type="button" onClick={onRegister}>Create an account</button></p>
        </form>
      </main>
    </div>
  )
}
