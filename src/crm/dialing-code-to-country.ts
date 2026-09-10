// Maps a phone dialing code (CrmUser.countryCode, e.g. "91") to an ISO
// 3166-1 alpha-2 country code (e.g. "IN") — a distinct concept from the
// literal "country" field on user.registered payloads, but a usable
// fallback source for the same players.country column when that field
// was never received (see the investigation that led to this file:
// getUsers now returns countryCode for every player, including many with
// no registration event on file at all).
//
// Deliberately NOT exhaustive, and deliberately excludes genuinely
// ambiguous shared codes (bare "1" for NANP — US/Canada/many Caribbean
// nations; "7" for Russia vs Kazakhstan) rather than guess at which
// country a shared code means. Unambiguous NANP sub-codes like "1868"
// (Trinidad and Tobago) and "1876" (Jamaica) are fine and included.
// Covers common real-world codes; an unrecognized code simply isn't in
// this table (see mapDialingCodeToCountry below) — it never causes an
// error or a guessed value.
export const DIALING_CODE_TO_COUNTRY: Record<string, string> = {
  "91": "IN", // India
  "374": "AM", // Armenia
  "971": "AE", // United Arab Emirates
  "1868": "TT", // Trinidad and Tobago
  "1876": "JM", // Jamaica
  "1246": "BB", // Barbados
  "93": "AF", // Afghanistan
  "92": "PK", // Pakistan
  "880": "BD", // Bangladesh
  "94": "LK", // Sri Lanka
  "977": "NP", // Nepal
  "95": "MM", // Myanmar
  "60": "MY", // Malaysia
  "65": "SG", // Singapore
  "66": "TH", // Thailand
  "63": "PH", // Philippines
  "62": "ID", // Indonesia
  "84": "VN", // Vietnam
  "86": "CN", // China
  "82": "KR", // South Korea
  "81": "JP", // Japan
  "852": "HK", // Hong Kong
  "886": "TW", // Taiwan
  "44": "GB", // United Kingdom
  "33": "FR", // France
  "49": "DE", // Germany
  "39": "IT", // Italy
  "34": "ES", // Spain
  "31": "NL", // Netherlands
  "32": "BE", // Belgium
  "41": "CH", // Switzerland
  "43": "AT", // Austria
  "46": "SE", // Sweden
  "47": "NO", // Norway
  "45": "DK", // Denmark
  "358": "FI", // Finland
  "351": "PT", // Portugal
  "30": "GR", // Greece
  "90": "TR", // Turkey
  "20": "EG", // Egypt
  "27": "ZA", // South Africa
  "234": "NG", // Nigeria
  "254": "KE", // Kenya
  "233": "GH", // Ghana
  "966": "SA", // Saudi Arabia
  "974": "QA", // Qatar
  "965": "KW", // Kuwait
  "973": "BH", // Bahrain
  "968": "OM", // Oman
  "962": "JO", // Jordan
  "961": "LB", // Lebanon
  "972": "IL", // Israel
  "61": "AU", // Australia
  "64": "NZ", // New Zealand
  "55": "BR", // Brazil
  "52": "MX", // Mexico
  "54": "AR", // Argentina
  "56": "CL", // Chile
  "57": "CO", // Colombia
  "51": "PE", // Peru
  "58": "VE", // Venezuela
  "375": "BY", // Belarus
  "380": "UA", // Ukraine
  "48": "PL", // Poland
  "420": "CZ", // Czech Republic
  "36": "HU", // Hungary
  "40": "RO", // Romania
  "359": "BG", // Bulgaria
  "385": "HR", // Croatia
  "386": "SI", // Slovenia
  "995": "GE", // Georgia
  "994": "AZ", // Azerbaijan
  "998": "UZ", // Uzbekistan
  "353": "IE", // Ireland
  "354": "IS", // Iceland
  "372": "EE", // Estonia
  "371": "LV", // Latvia
  "370": "LT", // Lithuania
};

export function mapDialingCodeToCountry(countryCode: string | null | undefined): string | undefined {
  if (!countryCode) return undefined;
  return DIALING_CODE_TO_COUNTRY[countryCode];
}
