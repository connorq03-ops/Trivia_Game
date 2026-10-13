import type { ChoiceBadge, Question } from '../src/game/types.js'

// Server-side only: importing this module into client code would leak answer
// names into the bundle (see scripts/check-bundle.mjs). Badge data rides out
// on each question via publicQuestion() in lib/questions.ts.

type TeamBadge = { abbr: string; primary: string; secondary: string }

// NFL + NBA: ESPN-style short abbreviations; colors are each team's official
// primary/secondary hex (Wikipedia infobox colors, cross-checked with
// teamcolorcodes.com). SuperSonics use the historical green/gold.
const TEAMS: Record<string, TeamBadge> = {
  // NFL — Wikipedia infobox / teamcolorcodes.com
  'NFL:49ers': { abbr: 'SF', primary: '#aa0000', secondary: '#b3995d' },
  'NFL:Bills': { abbr: 'BUF', primary: '#00338d', secondary: '#c60c30' },
  'NFL:Broncos': { abbr: 'DEN', primary: '#fb4f14', secondary: '#002244' },
  'NFL:Browns': { abbr: 'CLE', primary: '#311d00', secondary: '#ff3c00' },
  'NFL:Buccaneers': { abbr: 'TB', primary: '#d50a0a', secondary: '#b1babf' },
  'NFL:Chargers': { abbr: 'LAC', primary: '#0080c6', secondary: '#ffc20e' },
  'NFL:Chiefs': { abbr: 'KC', primary: '#e31837', secondary: '#ffb81c' },
  'NFL:Colts': { abbr: 'IND', primary: '#002c5f', secondary: '#a2aaad' },
  'NFL:Cowboys': { abbr: 'DAL', primary: '#003594', secondary: '#869397' },
  'NFL:Dolphins': { abbr: 'MIA', primary: '#008e97', secondary: '#fc4c02' },
  'NFL:Falcons': { abbr: 'ATL', primary: '#a71930', secondary: '#000000' },
  'NFL:Giants': { abbr: 'NYG', primary: '#0b2265', secondary: '#a71930' },
  'NFL:Jets': { abbr: 'NYJ', primary: '#125740', secondary: '#000000' },
  'NFL:Packers': { abbr: 'GB', primary: '#203731', secondary: '#ffb612' },
  'NFL:Panthers': { abbr: 'CAR', primary: '#0085ca', secondary: '#101820' },
  'NFL:Patriots': { abbr: 'NE', primary: '#002244', secondary: '#c60c30' },
  'NFL:Rams': { abbr: 'LAR', primary: '#003594', secondary: '#ffa300' },
  'NFL:Ravens': { abbr: 'BAL', primary: '#241773', secondary: '#9e7c0c' },
  'NFL:Saints': { abbr: 'NO', primary: '#101820', secondary: '#d3bc8d' },
  'NFL:Seahawks': { abbr: 'SEA', primary: '#002244', secondary: '#69be28' },
  'NFL:Steelers': { abbr: 'PIT', primary: '#101820', secondary: '#ffb612' },
  'NFL:Titans': { abbr: 'TEN', primary: '#0c2340', secondary: '#4b92db' },
  'NFL:Vikings': { abbr: 'MIN', primary: '#4f2683', secondary: '#ffc62f' },

  // NBA — Wikipedia infobox / teamcolorcodes.com
  'NBA:76ers': { abbr: 'PHI', primary: '#006bb6', secondary: '#ed174c' },
  'NBA:Bucks': { abbr: 'MIL', primary: '#00471b', secondary: '#eee1c6' },
  'NBA:Bulls': { abbr: 'CHI', primary: '#ce1141', secondary: '#000000' },
  'NBA:Cavaliers': { abbr: 'CLE', primary: '#860038', secondary: '#fdbb30' },
  'NBA:Celtics': { abbr: 'BOS', primary: '#007a33', secondary: '#ba9653' },
  'NBA:Clippers': { abbr: 'LAC', primary: '#c8102e', secondary: '#1d428a' },
  'NBA:Grizzlies': { abbr: 'MEM', primary: '#5d76a9', secondary: '#12173f' },
  'NBA:Hawks': { abbr: 'ATL', primary: '#e03a3e', secondary: '#c1d32f' },
  'NBA:Heat': { abbr: 'MIA', primary: '#98002e', secondary: '#f9a01b' },
  'NBA:Hornets': { abbr: 'CHA', primary: '#1d1160', secondary: '#00788c' },
  'NBA:Kings': { abbr: 'SAC', primary: '#5a2d81', secondary: '#63727a' },
  'NBA:Lakers': { abbr: 'LAL', primary: '#552583', secondary: '#fdb927' },
  'NBA:Magic': { abbr: 'ORL', primary: '#0077c0', secondary: '#c4ced4' },
  'NBA:Mavericks': { abbr: 'DAL', primary: '#00538c', secondary: '#b8c4ca' },
  'NBA:Nets': { abbr: 'BKN', primary: '#000000', secondary: '#ffffff' },
  'NBA:Nuggets': { abbr: 'DEN', primary: '#0e2240', secondary: '#fec524' },
  'NBA:Pacers': { abbr: 'IND', primary: '#002d62', secondary: '#fdbb30' },
  'NBA:Pistons': { abbr: 'DET', primary: '#c8102e', secondary: '#1d42ba' },
  'NBA:Raptors': { abbr: 'TOR', primary: '#ce1141', secondary: '#000000' },
  'NBA:Rockets': { abbr: 'HOU', primary: '#ce1141', secondary: '#c4ced4' },
  'NBA:Spurs': { abbr: 'SAS', primary: '#000000', secondary: '#c4ced4' },
  // Historical SuperSonics green/gold (1967–2008 identity)
  'NBA:SuperSonics': { abbr: 'SEA', primary: '#006633', secondary: '#ffc200' },
  'NBA:Suns': { abbr: 'PHX', primary: '#1d1160', secondary: '#e56020' },
  'NBA:Thunder': { abbr: 'OKC', primary: '#007ac1', secondary: '#ef3b24' },
  'NBA:Timberwolves': { abbr: 'MIN', primary: '#0c2340', secondary: '#236192' },
  'NBA:Trail Blazers': { abbr: 'POR', primary: '#e03a3e', secondary: '#000000' },
  'NBA:Warriors': { abbr: 'GSW', primary: '#1d428a', secondary: '#ffc72c' },
}

// NCAA schools keyed by their content/players.json names. Abbreviations are
// ESPN-style short forms; colors are the school's primary/secondary brand
// hex (Wikipedia infobox / teamcolorcodes.com).
const COLLEGES: Record<string, TeamBadge> = {
  Alabama: { abbr: 'ALA', primary: '#9e1b32', secondary: '#828a8f' },
  'Alcorn State': { abbr: 'ALCN', primary: '#4b2e83', secondary: '#c69214' },
  Arizona: { abbr: 'ARIZ', primary: '#cc0036', secondary: '#003366' },
  'Arizona State': { abbr: 'ASU', primary: '#8c1d40', secondary: '#ffc627' },
  Arkansas: { abbr: 'ARK', primary: '#9d2235', secondary: '#ffffff' },
  Auburn: { abbr: 'AUB', primary: '#0c2340', secondary: '#e87722' },
  BYU: { abbr: 'BYU', primary: '#002255', secondary: '#ffffff' },
  Baylor: { abbr: 'BAY', primary: '#154734', secondary: '#ffb81c' },
  'Boise State': { abbr: 'BSU', primary: '#0033a0', secondary: '#d64309' },
  Butler: { abbr: 'BUT', primary: '#13294b', secondary: '#75787b' },
  California: { abbr: 'CAL', primary: '#003262', secondary: '#fdb515' },
  Cincinnati: { abbr: 'CIN', primary: '#e00122', secondary: '#000000' },
  Clemson: { abbr: 'CLEM', primary: '#f56600', secondary: '#522d80' },
  Davidson: { abbr: 'DAV', primary: '#ac1a2f', secondary: '#000000' },
  DePaul: { abbr: 'DEP', primary: '#0057b8', secondary: '#e4002b' },
  Drake: { abbr: 'DRAK', primary: '#004477', secondary: '#b3b9b8' },
  Duke: { abbr: 'DUKE', primary: '#003087', secondary: '#ffffff' },
  'Eastern Illinois': { abbr: 'EIU', primary: '#0c2340', secondary: '#75787b' },
  Florida: { abbr: 'FLA', primary: '#0021a5', secondary: '#fa4616' },
  'Florida A&M': { abbr: 'FAMU', primary: '#008344', secondary: '#f4811f' },
  'Florida State': { abbr: 'FSU', primary: '#782f40', secondary: '#ceb888' },
  'Fresno State': { abbr: 'FRES', primary: '#c41230', secondary: '#002e6d' },
  Georgetown: { abbr: 'GTWN', primary: '#041e42', secondary: '#8d817b' },
  Georgia: { abbr: 'UGA', primary: '#ba0c2f', secondary: '#000000' },
  'Georgia Tech': { abbr: 'GT', primary: '#b3a369', secondary: '#003057' },
  Gonzaga: { abbr: 'GONZ', primary: '#041e42', secondary: '#c8102e' },
  'Grambling State': { abbr: 'GRAM', primary: '#000000', secondary: '#ffb81c' },
  Houston: { abbr: 'HOU', primary: '#c8102e', secondary: '#b2b4b2' },
  Illinois: { abbr: 'ILL', primary: '#13294b', secondary: '#e84a27' },
  'Illinois State': { abbr: 'ILST', primary: '#ce1126', secondary: '#000000' },
  Iowa: { abbr: 'IOWA', primary: '#000000', secondary: '#ffcd00' },
  'Iowa State': { abbr: 'ISU', primary: '#c8102e', secondary: '#f1be48' },
  'Jackson State': { abbr: 'JKST', primary: '#002147', secondary: '#c8102e' },
  Kansas: { abbr: 'KU', primary: '#0051ba', secondary: '#e8000d' },
  'Kansas State': { abbr: 'KSU', primary: '#512888', secondary: '#d1d1d1' },
  'Kent State': { abbr: 'KENT', primary: '#002664', secondary: '#eaab00' },
  Kentucky: { abbr: 'UK', primary: '#0033a0', secondary: '#ffffff' },
  LSU: { abbr: 'LSU', primary: '#461d7c', secondary: '#fdd023' },
  Louisville: { abbr: 'LOU', primary: '#ad0000', secondary: '#000000' },
  Marquette: { abbr: 'MARQ', primary: '#003366', secondary: '#ffcc00' },
  Marshall: { abbr: 'MRSH', primary: '#00b525', secondary: '#ffffff' },
  'Miami (FL)': { abbr: 'MIA', primary: '#005030', secondary: '#f47321' },
  Michigan: { abbr: 'MICH', primary: '#00274c', secondary: '#ffcb05' },
  'Michigan State': { abbr: 'MSU', primary: '#18453b', secondary: '#ffffff' },
  Minnesota: { abbr: 'MINN', primary: '#7a0019', secondary: '#ffcc33' },
  'Mississippi State': { abbr: 'MSST', primary: '#660000', secondary: '#ffffff' },
  'Mississippi Valley State': {
    abbr: 'MVSU',
    primary: '#046a38',
    secondary: '#e8112d',
  },
  Missouri: { abbr: 'MIZZ', primary: '#000000', secondary: '#f1b82d' },
  Montana: { abbr: 'MONT', primary: '#5e001d', secondary: '#8c8474' },
  'NC State': { abbr: 'NCST', primary: '#cc0000', secondary: '#000000' },
  'North Carolina': { abbr: 'UNC', primary: '#7bafd4', secondary: '#13294f' },
  'Northern Iowa': { abbr: 'UNI', primary: '#4b116f', secondary: '#ffcc00' },
  'Notre Dame': { abbr: 'ND', primary: '#0c2340', secondary: '#ae9142' },
  'Ohio State': { abbr: 'OSU', primary: '#bb0000', secondary: '#666666' },
  Oklahoma: { abbr: 'OU', primary: '#841617', secondary: '#fdf9d8' },
  'Oklahoma State': { abbr: 'OKST', primary: '#ff7300', secondary: '#000000' },
  'Ole Miss': { abbr: 'MISS', primary: '#ce1126', secondary: '#14213d' },
  Oregon: { abbr: 'ORE', primary: '#154733', secondary: '#fee123' },
  'Oregon State': { abbr: 'ORST', primary: '#dc4405', secondary: '#000000' },
  'Penn State': { abbr: 'PSU', primary: '#041e42', secondary: '#ffffff' },
  Pittsburgh: { abbr: 'PITT', primary: '#003594', secondary: '#ffb81c' },
  'Prairie View A&M': { abbr: 'PVAM', primary: '#582c83', secondary: '#fdb813' },
  Purdue: { abbr: 'PUR', primary: '#000000', secondary: '#cfb991' },
  SMU: { abbr: 'SMU', primary: '#0033a0', secondary: '#c8102e' },
  'San Diego State': { abbr: 'SDSU', primary: '#a6192e', secondary: '#000000' },
  'Southern Illinois': { abbr: 'SIU', primary: '#720000', secondary: '#c2c9c8' },
  'Southern Miss': { abbr: 'USM', primary: '#000000', secondary: '#ffaa00' },
  Stanford: { abbr: 'STAN', primary: '#8c1515', secondary: '#ffffff' },
  Syracuse: { abbr: 'SYR', primary: '#d44500', secondary: '#000e54' },
  TCU: { abbr: 'TCU', primary: '#4d1979', secondary: '#a3a9ac' },
  Tennessee: { abbr: 'TENN', primary: '#ff8200', secondary: '#ffffff' },
  Texas: { abbr: 'TEX', primary: '#bf5700', secondary: '#ffffff' },
  'Texas A&M': { abbr: 'TAMU', primary: '#500000', secondary: '#ffffff' },
  'Texas Southern': { abbr: 'TXSO', primary: '#7a0019', secondary: '#a7a8aa' },
  'Texas Tech': { abbr: 'TTU', primary: '#cc0000', secondary: '#000000' },
  Toledo: { abbr: 'TOL', primary: '#15397f', secondary: '#ffda00' },
  Tulane: { abbr: 'TUL', primary: '#006747', secondary: '#418fde' },
  UCLA: { abbr: 'UCLA', primary: '#2774ae', secondary: '#ffd100' },
  UConn: { abbr: 'CONN', primary: '#000e2f', secondary: '#e4002b' },
  UNLV: { abbr: 'UNLV', primary: '#cf0a2c', secondary: '#666666' },
  USC: { abbr: 'USC', primary: '#990000', secondary: '#ffc72c' },
  Utah: { abbr: 'UTAH', primary: '#cc0000', secondary: '#ffffff' },
  'Utah State': { abbr: 'USU', primary: '#0f2439', secondary: '#ffffff' },
  Villanova: { abbr: 'VILL', primary: '#00205b', secondary: '#13b5ea' },
  Virginia: { abbr: 'UVA', primary: '#232d4b', secondary: '#f84c1e' },
  'Virginia Tech': { abbr: 'VT', primary: '#630031', secondary: '#cf4420' },
  'Wake Forest': { abbr: 'WAKE', primary: '#000000', secondary: '#9e7e38' },
  Washington: { abbr: 'WASH', primary: '#4b2e83', secondary: '#b7a57a' },
  'Washington State': { abbr: 'WSU', primary: '#981e32', secondary: '#5e6a71' },
  'Weber State': { abbr: 'WEB', primary: '#492365', secondary: '#ffffff' },
  'West Virginia': { abbr: 'WVU', primary: '#002855', secondary: '#eaaa00' },
  Wisconsin: { abbr: 'WIS', primary: '#c5050c', secondary: '#ffffff' },
  Wyoming: { abbr: 'WYO', primary: '#492f24', secondary: '#ffc425' },
}

// Country name → lowercase flag-icons code (public/flags/<code>.svg).
const FLAGS: Record<string, string> = {
  Argentina: 'ar',
  Australia: 'au',
  Austria: 'at',
  Brazil: 'br',
  Cameroon: 'cm',
  Canada: 'ca',
  China: 'cn',
  Croatia: 'hr',
  England: 'gb-eng',
  France: 'fr',
  Germany: 'de',
  Ghana: 'gh',
  Greece: 'gr',
  Italy: 'it',
  Japan: 'jp',
  Montenegro: 'me',
  Netherlands: 'nl',
  'New Zealand': 'nz',
  Nigeria: 'ng',
  Portugal: 'pt',
  Senegal: 'sn',
  Serbia: 'rs',
  Slovakia: 'sk',
  Slovenia: 'si',
  'South Korea': 'kr',
  Spain: 'es',
  Switzerland: 'ch',
  Taiwan: 'tw',
  Turkey: 'tr',
  Uruguay: 'uy',
}

function teamBadge(team: TeamBadge | undefined): ChoiceBadge | null {
  return team ? { kind: 'team', ...team } : null
}

export function badgeFor(question: Question, choice: string): ChoiceBadge | null {
  switch (question.category) {
    case 'Alma mater':
      return teamBadge(COLLEGES[choice])
    case 'Drafted by':
      return teamBadge(TEAMS[`${question.leagues[0]}:${choice}`])
    case 'Country': {
      const code = FLAGS[choice]
      return code ? { kind: 'flag', code } : null
    }
    default:
      return null
  }
}

export function badgeCategory(category: string): boolean {
  return (
    category === 'Alma mater' || category === 'Drafted by' || category === 'Country'
  )
}
