// Seed URLs for the crawler. Every seed is re-checked on its own interval; the crawler also
// discovers additional official pages/PDFs linked from tier-1 pages (see lib/crawler.js).
//
// interval: hours between checks. Pages that change often (announcements, athletics, news) are
// checked daily; stable policy/course pages every couple of days; PDFs weekly.

const DAILY = 24
const OFTEN = 48
const WEEKLY = 168

/** @type {{ url: string, interval: number, note?: string }[]} */
export const SEEDS = [
  // --- Cedar Cliff core -------------------------------------------------------------------
  { url: 'https://www.wssd.k12.pa.us/cedarcliff.aspx', interval: DAILY, note: 'Cedar Cliff home (nav discovery)' },
  { url: 'https://www.wssd.k12.pa.us/', interval: DAILY, note: 'District home (nav discovery: calendar, board, transportation…)' },
  { url: 'https://www.wssd.k12.pa.us/AboutCedarCliffHighSchool.aspx', interval: OFTEN },
  { url: 'https://www.wssd.k12.pa.us/PrincipalsMessage.aspx', interval: OFTEN },
  { url: 'https://www.wssd.k12.pa.us/monthlynewsletter7606.aspx', interval: DAILY },
  { url: 'https://www.wssd.k12.pa.us/SuccessStories.aspx', interval: OFTEN },
  { url: 'https://www.wssd.k12.pa.us/DistrictHandbooks.aspx', interval: OFTEN, note: 'links to handbook PDFs' },
  { url: 'https://www.wssd.k12.pa.us/Students.aspx', interval: OFTEN },
  { url: 'https://www.wssd.k12.pa.us/Parents.aspx', interval: OFTEN },
  { url: 'https://www.wssd.k12.pa.us/StudentAttendance.aspx', interval: OFTEN },
  { url: 'https://www.wssd.k12.pa.us/AttendanceInformation.aspx', interval: OFTEN },
  { url: 'https://www.wssd.k12.pa.us/WorkPermits.aspx', interval: OFTEN },
  { url: 'https://www.wssd.k12.pa.us/DailyAnnouncements1.aspx', interval: DAILY },
  { url: 'https://www.wssd.k12.pa.us/CedarCliffGuidance.aspx', interval: OFTEN },
  { url: 'https://www.wssd.k12.pa.us/HighSchoolBellSchedule.aspx', interval: OFTEN },
  { url: 'https://psweb.wssd.k12.pa.us/public/', interval: WEEKLY },

  // --- Parent & Student Handbook sections (the handbook is a set of HTML pages, not one PDF) ---
  { url: 'https://www.wssd.k12.pa.us/AttendanceAbsences.aspx', interval: OFTEN },
  { url: 'https://www.wssd.k12.pa.us/generalinformation6814.aspx', interval: OFTEN },
  { url: 'https://www.wssd.k12.pa.us/StudentRelatedBoardPolicies.aspx', interval: OFTEN },
  { url: 'https://www.wssd.k12.pa.us/SecondaryEducation.aspx', interval: OFTEN },
  { url: 'https://www.wssd.k12.pa.us/HealthServices1.aspx', interval: OFTEN },
  { url: 'https://www.wssd.k12.pa.us/AnnualNotifications.aspx', interval: OFTEN },
  { url: 'https://www.wssd.k12.pa.us/InclementWeatherInformation.aspx', interval: DAILY },
  { url: 'https://www.wssd.k12.pa.us/TechnologyDeviceFAQs.aspx', interval: WEEKLY },
  { url: 'https://www.wssd.k12.pa.us/RulesforRidingtheBus.aspx', interval: WEEKLY },
  { url: 'https://www.wssd.k12.pa.us/TransportationExceptionRequest.aspx', interval: WEEKLY },

  // --- District-wide pages students ask about --------------------------------------------
  { url: 'https://www.wssd.k12.pa.us/CalendarsBellSchedules.aspx', interval: DAILY },
  { url: 'https://www.wssd.k12.pa.us/Transportation1.aspx', interval: OFTEN },
  { url: 'https://www.wssd.k12.pa.us/Transportation.aspx', interval: OFTEN },
  { url: 'https://www.wssd.k12.pa.us/SchoolBoard.aspx', interval: OFTEN },
  { url: 'https://www.wssd.k12.pa.us/BoardMeetings.aspx', interval: OFTEN },
  { url: 'https://www.wssd.k12.pa.us/BoardPolicies.aspx', interval: OFTEN },
  { url: 'https://www.wssd.k12.pa.us/CentralOfficeAdministration.aspx', interval: OFTEN },
  { url: 'https://www.wssd.k12.pa.us/Directory.aspx', interval: OFTEN, note: 'staff directory' },
  { url: 'https://www.wssd.k12.pa.us/CentralRegistrationforNewStudents.aspx', interval: OFTEN },
  { url: 'https://www.wssd.k12.pa.us/HealthServices.aspx', interval: OFTEN },
  { url: 'https://www.wssd.k12.pa.us/TechnologyMedia.aspx', interval: OFTEN },
  { url: 'https://www.wssd.k12.pa.us/excelacademy.aspx', interval: OFTEN },
  { url: 'https://www.wssd.k12.pa.us/OnlineLearning.aspx', interval: OFTEN },
  { url: 'https://www.wssd.k12.pa.us/InternetAccessatHome.aspx', interval: WEEKLY },

  // --- Clubs / activities ------------------------------------------------------------------
  { url: 'https://www.wssd.k12.pa.us/Aquaponics.aspx', interval: OFTEN },
  { url: 'https://www.wssd.k12.pa.us/FriendsForever.aspx', interval: OFTEN },
  { url: 'https://www.wssd.k12.pa.us/MrsKamps.aspx', interval: OFTEN },
  { url: 'https://www.wssd.k12.pa.us/KeyClub.aspx', interval: OFTEN },
  { url: 'https://www.wssd.k12.pa.us/CedarCliffJROTC.aspx', interval: OFTEN },
  { url: 'https://www.wssd.k12.pa.us/CedarCliffYearbook.aspx', interval: OFTEN },
  { url: 'https://www.wssd.k12.pa.us/CedarCliffNHS.aspx', interval: OFTEN },
  { url: 'https://www.wssd.k12.pa.us/ActivityFee.aspx', interval: OFTEN },
  { url: 'https://www.cedarcliffproductions.com/', interval: OFTEN },
  { url: 'https://sites.google.com/wssd.bz/cchs-honors-ap-college', interval: OFTEN },
  { url: 'https://sites.google.com/wssd.bz/the-cedar-cliff-colt-online-ne', interval: DAILY },
  { url: 'https://sites.google.com/wssd.bz/the-cedar-cliff-colt-online-ne/home/cc-school-news', interval: DAILY },
  { url: 'https://sites.google.com/wssd.bz/the-cedar-cliff-colt-online-ne/home/cc-community-news', interval: DAILY },
  { url: 'https://sites.google.com/wssd.bz/the-cedar-cliff-colt-online-ne/home/cc-sports-news', interval: DAILY },
  { url: 'https://sites.google.com/wssd.bz/the-cedar-cliff-colt-online-ne/home/cc-lifestyle-news', interval: DAILY },
  { url: 'https://sites.google.com/wssd.bz/the-cedar-cliff-colt-online-ne/home/cc-special-news', interval: DAILY },

  // --- Athletics -----------------------------------------------------------------------------
  { url: 'https://www.wssd.k12.pa.us/AthleticsCCHS.aspx', interval: DAILY },
  { url: 'https://www.wssd.k12.pa.us/Athletics.aspx', interval: DAILY },
  { url: 'https://www.wssd.k12.pa.us/AthleticForms.aspx', interval: OFTEN },
  { url: 'https://www.wssd.k12.pa.us/DirectionstoAreaSchools.aspx', interval: WEEKLY },
  { url: 'https://www.wssd.k12.pa.us/InterscholasticAthleticDisclosureForms.aspx', interval: WEEKLY },
  { url: 'https://www.wssd.k12.pa.us/WestShoreNatatorium.aspx', interval: OFTEN },
  { url: 'https://www.wssd.k12.pa.us/WestShoreStadiumBagPolicy.aspx', interval: WEEKLY },
  { url: 'https://www.arbiterlive.com/Teams?entityId=3551', interval: DAILY },

  // --- Food service -------------------------------------------------------------------------
  { url: 'https://www.wssd.k12.pa.us/Monthlye-News.aspx', interval: DAILY },
  { url: 'https://www.wssd.k12.pa.us/FoodServices.aspx', interval: OFTEN },
  { url: 'https://www.wssd.k12.pa.us/Menus.aspx', interval: DAILY },
  { url: 'https://www.wssd.k12.pa.us/FreeandReducedMeals.aspx', interval: OFTEN },
  { url: 'https://www.wssd.k12.pa.us/StudentMealAccounts.aspx', interval: OFTEN },
  { url: 'https://www.wssd.k12.pa.us/WellnessPolicyNutritionalStandards.aspx', interval: WEEKLY },

  // --- Academic policies / scheduling ------------------------------------------------------
  { url: 'https://www.wssd.k12.pa.us/CourseSequencingCredits.aspx', interval: OFTEN },
  { url: 'https://www.wssd.k12.pa.us/CreditRequirements.aspx', interval: OFTEN },
  { url: 'https://www.wssd.k12.pa.us/AcademicContract.aspx', interval: OFTEN },
  { url: 'https://www.wssd.k12.pa.us/AdvancedPlacementCourses.aspx', interval: OFTEN },
  { url: 'https://www.wssd.k12.pa.us/EarlyAdmissions.aspx', interval: OFTEN },
  { url: 'https://www.wssd.k12.pa.us/EarlyGraduation.aspx', interval: OFTEN },
  { url: 'https://www.wssd.k12.pa.us/Make-UpofFailures.aspx', interval: OFTEN },
  { url: 'https://www.wssd.k12.pa.us/ScheduleChanges.aspx', interval: OFTEN },
  { url: 'https://www.wssd.k12.pa.us/SeniorOption.aspx', interval: OFTEN },
  { url: 'https://www.wssd.k12.pa.us/StudyingAbroad.aspx', interval: OFTEN },
  { url: 'https://www.wssd.k12.pa.us/TeenParentingDayCareProgram.aspx', interval: WEEKLY },
  { url: 'https://www.wssd.k12.pa.us/WeightedGrades.aspx', interval: OFTEN },

  // --- Course offerings by department ------------------------------------------------------
  { url: 'https://www.wssd.k12.pa.us/Art.aspx', interval: OFTEN },
  { url: 'https://www.wssd.k12.pa.us/BusinessandMarketing.aspx', interval: OFTEN },
  { url: 'https://www.wssd.k12.pa.us/ComputerScience.aspx', interval: OFTEN },
  { url: 'https://www.wssd.k12.pa.us/EngineeringandTechnology.aspx', interval: OFTEN },
  { url: 'https://www.wssd.k12.pa.us/English.aspx', interval: OFTEN },
  { url: 'https://www.wssd.k12.pa.us/EnglishLanguageDev.aspx', interval: OFTEN },
  { url: 'https://www.wssd.k12.pa.us/HealthPhysicalEd.aspx', interval: OFTEN },
  { url: 'https://www.wssd.k12.pa.us/JuniorReserveOfficersTrainingCorpsJROTC.aspx', interval: OFTEN },
  { url: 'https://www.wssd.k12.pa.us/Library.aspx', interval: OFTEN },
  { url: 'https://www.wssd.k12.pa.us/Mathematics.aspx', interval: OFTEN },
  { url: 'https://www.wssd.k12.pa.us/Music.aspx', interval: OFTEN },
  { url: 'https://www.wssd.k12.pa.us/Science.aspx', interval: OFTEN },
  { url: 'https://www.wssd.k12.pa.us/SocialStudies.aspx', interval: OFTEN },
  { url: 'https://www.wssd.k12.pa.us/SpecialEducation.aspx', interval: OFTEN },
  { url: 'https://www.wssd.k12.pa.us/WorldLanguages.aspx', interval: OFTEN },
  { url: 'https://www.wssd.k12.pa.us/CooperativeEducation.aspx', interval: OFTEN },
  { url: 'https://www.wssd.k12.pa.us/DualEnrollment.aspx', interval: OFTEN },
  { url: 'https://www.wssd.k12.pa.us/PathwayInternships.aspx', interval: OFTEN },
]

// MaxPreps — Cedar Cliff Colts (schedules / scores / rosters). Checked daily in season.
const MAXPREPS_TEAMS = [
  'baseball', 'basketball', 'cross-country', 'football', 'golf', 'lacrosse', 'soccer', 'tennis', 'track-field',
  'volleyball/boys', 'wrestling',
  'basketball/girls', 'field-hockey', 'golf/girls', 'lacrosse/girls', 'soccer/girls', 'softball', 'tennis/girls',
  'track-field/girls', 'volleyball',
  'baseball/jv', 'basketball/jv', 'football/jv', 'lacrosse/jv', 'soccer/jv', 'volleyball/boys/jv', 'basketball/girls/jv',
  'field-hockey/jv', 'lacrosse/girls/jv', 'soccer/girls/jv/spring', 'softball/jv', 'volleyball/jv',
  'basketball/freshman', 'football/freshman', 'basketball/girls/freshman', 'field-hockey/freshman',
]
for (const t of MAXPREPS_TEAMS) {
  SEEDS.push({ url: `https://www.maxpreps.com/pa/camp-hill/cedar-cliff-colts/${t}/`, interval: DAILY })
}

/** Plain URL list, for backwards compatibility with the original scraper export. */
export const SEED_URLS = SEEDS.map((s) => s.url)

/**
 * Discovery rules for links found on official pages.
 * Returns { allow: boolean, kind: 'html'|'pdf'|'doc', interval } for a candidate URL.
 */
export function discoveryRule(url, { fromUrl, depth }) {
  let u
  try {
    u = new URL(url)
  } catch {
    return { allow: false }
  }
  const host = u.hostname.toLowerCase().replace(/^www\./, '')
  const path = u.pathname
  if (host === 'curriculum.wssd.k12.pa.us') return { allow: false }
  const isPdf = /\.pdf$/i.test(path)
  const isGoogleDoc = host === 'docs.google.com' || host === 'drive.google.com'

  if (isGoogleDoc) {
    // Only Google Docs/Drive files *linked from* official pages, and only document-ish links.
    if (!/\/(document|file|spreadsheets|presentation)\/d\//.test(path) && !u.searchParams.get('id')) return { allow: false }
    return { allow: true, kind: 'doc', interval: WEEKLY }
  }

  if (host === 'wssd.k12.pa.us' || host.endsWith('.wssd.k12.pa.us')) {
    if (isPdf) return { allow: true, kind: 'pdf', interval: WEEKLY }
    if (host !== 'wssd.k12.pa.us') return { allow: false }
    if (depth >= 2) return { allow: false } // HTML discovery is one hop from seeds only
    if (!/\.aspx$/i.test(path)) return { allow: false }
    if (u.search && !/^\?(id|page|Id|PageId)=\d+$/.test(u.search)) return { allow: false }
    // Skip other schools in the district, and utility pages.
    if (
      /(redland|allen|crossroads|newcumberland|fairview|oldtrail|fishingcreek|highland|hillside|newberry|redmill|rossmoyne|washingtonheights|elementary|middleschool|intermediate)/i.test(
        path,
      ) &&
      !/cedar|highschool|district|board|calendar|transport/i.test(path)
    ) {
      return { allow: false }
    }
    if (/(login|logout|search|print|sitemap|accessibility|privacy|terms|rss|feed|photogallery|slideshow|staffdirectory\?|default\.aspx$|^\/protected\/|^\/controls)/i.test(path)) {
      return { allow: false }
    }
    return { allow: true, kind: 'html', interval: 72 }
  }

  if (host === 'sites.google.com' && /^\/(wssd\.bz|a\/wssd\.k12\.pa\.us)\//.test(path)) {
    if (depth >= 2) return { allow: false }
    // Stay within the same Google Site as the page that linked it.
    const fromPath = safePath(fromUrl)
    const site = path.split('/').slice(0, 3).join('/')
    if (!fromPath.startsWith(site)) return { allow: false }
    return { allow: true, kind: 'html', interval: 72 }
  }

  if (host.endsWith('wssd.bz') && isPdf) return { allow: true, kind: 'pdf', interval: WEEKLY }
  if (host.endsWith('eschoolview.com') && isPdf) return { allow: true, kind: 'pdf', interval: WEEKLY } // WSSD CMS file host
  if (host === 'cedarcliffproductions.com' && depth < 2 && !u.search) return { allow: true, kind: 'html', interval: 72 }

  return { allow: false }
}

function safePath(url) {
  try {
    return new URL(url).pathname
  } catch {
    return ''
  }
}
