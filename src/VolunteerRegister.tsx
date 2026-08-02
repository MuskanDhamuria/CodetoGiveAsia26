import { useMemo, useState } from "react"
import { registerVolunteer, setVolunteerToken } from "./volunteer-api"
import { whatsappChatLink } from "./whatsapp-link"

const countryCodes = [
  ["+65", "SG +65"], ["+60", "MY +60"], ["+62", "ID +62"], ["+63", "PH +63"],
  ["+91", "IN +91"], ["+880", "BD +880"], ["+95", "MM +95"], ["+86", "CN +86"],
  ["+84", "VN +84"], ["+1", "US/CA +1"], ["+44", "UK +44"],
]

function passwordScore(password: string) {
  return [
    password.length >= 8,
    /[A-Z]/.test(password),
    /[a-z]/.test(password),
    /\d/.test(password),
  ].filter(Boolean).length
}

export default function VolunteerRegister({
  onRegistered,
  onLogin,
}: {
  onRegistered: () => void
  onLogin: () => void
}) {
  const [name, setName] = useState("")
  const [countryCode, setCountryCode] = useState("+65")
  const [phone, setPhone] = useState("")
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const score = useMemo(() => passwordScore(password), [password])

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    const localPhone = phone.replace(/\D/g, "")
    if (!name.trim()) return setError("Please enter your full name.")
    if (localPhone.length < 6) return setError("Please enter a valid phone number.")
    if (password !== confirmPassword) return setError("Passwords do not match.")
    if (score < 4) return setError("Please meet all password requirements.")
    setSubmitting(true)
    setError(null)
    try {
      const result = await registerVolunteer({
        name: name.trim(),
        contact_number: `${countryCode}${localPhone}`,
        password,
      })
      setVolunteerToken(result.access_token)
      onRegistered()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not create your account.")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="pts-account-page">
      <AccountHeader label="Volunteer registration" onLogin={onLogin} />
      <section className="pts-account-hero">
        <p>Join our community</p>
        <h1>Volunteer with Passion To Serve</h1>
        <span>Create an account to keep track of your event sign-ups in one place.</span>
      </section>
      <main className="pts-account-main">
        <div className="pts-account-side-copy">
          <p className="pts-account-eyebrow">One account, every event</p>
          <h2>Your volunteering journey, all in one place.</h2>
          <p>Save your details once, follow your event sign-ups, and keep track of the moments you have made an impact.</p>
          <div className="pts-account-benefit"><span>01</span><strong>Browse and join events</strong></div>
          <div className="pts-account-benefit"><span>02</span><strong>See your upcoming and past sign-ups</strong></div>
          <div className="pts-account-benefit"><span>03</span><strong>Access your volunteer records after approval</strong></div>
        </div>
        <form className="pts-account-card" onSubmit={handleSubmit}>
          <div className="pts-account-card-heading">
            <p className="pts-account-eyebrow">New volunteer</p>
            <h2>Create your account</h2>
          </div>
          <label className="pts-field"><span>Full name</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="Your name" /></label>
          <label className="pts-field">
            <span>Phone number</span>
            <div className="pts-phone-row">
              <select aria-label="Country code" value={countryCode} onChange={(event) => setCountryCode(event.target.value)}>
                {countryCodes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
              <input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="8123 4567" inputMode="tel" />
            </div>
          </label>
          <label className="pts-field pts-password-field">
            <span>Password <span className="pts-info-wrap">
              <button type="button" className="pts-info" aria-label="Password requirements" aria-describedby="password-requirements">i</button>
              <span id="password-requirements" className="pts-password-tooltip" role="tooltip">
                <strong>Your password should have:</strong>
                <span>8 or more characters</span>
                <span>Uppercase and lowercase letters</span>
                <span>At least one number</span>
              </span>
            </span></span>
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Create a strong password" />
            {password && <div className="pts-password-meter" aria-label={`${score} of 4 password requirements met`}><span style={{ width: `${score * 25}%` }} /></div>}
          </label>
          <label className="pts-field"><span>Confirm password</span><input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} placeholder="Re-enter your password" /></label>
          {error && <p className="pts-signup-error">{error}</p>}
          <button className="pts-signup-submit" type="submit" disabled={submitting}>{submitting ? "Creating account…" : "Create account"}</button>
          <p className="pts-account-switch">Already have an account? <button type="button" onClick={onLogin}>Sign in</button></p>
        </form>
      </main>
    </div>
  )
}

export function AccountHeader({ label, onLogin, onRegister, onSignOut }: { label: string; onLogin?: () => void; onRegister?: () => void; onSignOut?: () => void }) {
  return (
    <header className="pts-signup-topbar">
      <a className="pts-signup-logo" href="/community"><img src="/pts-logo.png" alt="" />Passion To Serve</a>
      <div className="pts-account-header-actions">
        <span className="pts-signup-tag">{label}</span>
        <a href="/community">Events</a>
        <a href={whatsappChatLink()} target="_blank" rel="noreferrer">Chat on WhatsApp</a>
        {onLogin && <button type="button" onClick={onLogin}>Sign in</button>}
        {onRegister && <button type="button" onClick={onRegister}>Create account</button>}
        {onSignOut && <button type="button" onClick={onSignOut}>Sign out</button>}
      </div>
    </header>
  )
}
