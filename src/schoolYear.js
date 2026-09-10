/**
 * Date-derived school-year facts so grade ↔ "Class of" labels never go stale.
 *
 * The school year rolls over on July 1: from July onward, the graduating class is next
 * calendar year's (e.g. Sep 2026 → seniors are the Class of 2027).
 */

/** Calendar year of the current graduating class (seniors). */
export function seniorClassYear(date = new Date()) {
  const y = date.getFullYear()
  return date.getMonth() >= 6 ? y + 1 : y
}

/** e.g. "2026-27" */
export function schoolYearLabel(date = new Date()) {
  const senior = seniorClassYear(date)
  return `${senior - 1}-${String(senior).slice(-2)}`
}

/** { seniors: 2027, juniors: 2028, sophomores: 2029, freshmen: 2030 } */
export function classYearsByGrade(date = new Date()) {
  const senior = seniorClassYear(date)
  return { seniors: senior, juniors: senior + 1, sophomores: senior + 2, freshmen: senior + 3 }
}

/**
 * Grade label for a graduating class in the current school year:
 * "seniors" / "juniors" / "sophomores" / "freshmen", "graduated", or "not yet in high school".
 */
export function gradeForClassYear(classYear, date = new Date()) {
  const diff = Number(classYear) - seniorClassYear(date)
  const labels = ['seniors', 'juniors', 'sophomores', 'freshmen']
  if (diff < 0) return 'graduated'
  return labels[diff] || 'not yet in high school'
}

/** Short, model-friendly summary: "Today is …; school year 2026-27; seniors = Class of 2027, …" */
export function schoolYearContextLine(date = new Date()) {
  const y = classYearsByGrade(date)
  const today = date.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
  return `Today is ${today}. Current school year: ${schoolYearLabel(date)}. Freshmen (9th) = Class of ${y.freshmen}, sophomores (10th) = Class of ${y.sophomores}, juniors (11th) = Class of ${y.juniors}, seniors (12th) = Class of ${y.seniors}.`
}
