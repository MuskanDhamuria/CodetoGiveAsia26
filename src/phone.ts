import {
  AsYouType,
  isValidPhoneNumber,
  parsePhoneNumberFromString,
  type CountryCode,
} from "libphonenumber-js"

export type PhoneCountryOption = {
  code: string
  country: CountryCode
  label: string
}

export const PHONE_COUNTRIES: PhoneCountryOption[] = [
  { code: "+65", country: "SG", label: "SG +65" },
  { code: "+60", country: "MY", label: "MY +60" },
  { code: "+62", country: "ID", label: "ID +62" },
  { code: "+63", country: "PH", label: "PH +63" },
  { code: "+91", country: "IN", label: "IN +91" },
  { code: "+880", country: "BD", label: "BD +880" },
  { code: "+95", country: "MM", label: "MM +95" },
  { code: "+86", country: "CN", label: "CN +86" },
  { code: "+84", country: "VN", label: "VN +84" },
  { code: "+1", country: "US", label: "US/CA +1" },
  { code: "+44", country: "GB", label: "UK +44" },
]

function countryOption(countryCode: string) {
  return PHONE_COUNTRIES.find((option) => option.code === countryCode) ?? PHONE_COUNTRIES[0]
}

export function phoneDigits(value: string) {
  return value.replace(/\D/g, "")
}

export function formatLocalPhoneAsYouType(countryCode: string, value: string) {
  return new AsYouType(countryOption(countryCode).country).input(phoneDigits(value))
}

export function toInternationalPhone(countryCode: string, localPhone: string) {
  return `${countryCode}${phoneDigits(localPhone)}`
}

export function isValidInternationalPhone(countryCode: string, localPhone: string) {
  return isValidPhoneNumber(toInternationalPhone(countryCode, localPhone))
}

export function formatPhoneForDisplay(value: string | null | undefined) {
  if (!value) return null
  return parsePhoneNumberFromString(value, "SG")?.formatInternational() ?? value
}

export function splitInternationalPhone(value: string | null | undefined) {
  if (!value) return { countryCode: "+65", localPhone: "" }
  const parsed = parsePhoneNumberFromString(value, "SG")
  if (!parsed) return { countryCode: "+65", localPhone: value }

  const countryCode = `+${parsed.countryCallingCode}`
  return {
    countryCode,
    localPhone: formatLocalPhoneAsYouType(countryCode, parsed.nationalNumber),
  }
}
