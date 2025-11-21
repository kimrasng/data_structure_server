const crypto = require('crypto')

const hashMac = (mac) => {
  return crypto.createHash('sha256').update(mac).digest()
}

const getStatus = (headcount, threshold) => {
  const t = threshold || {}
  const safe = Number(t.safe ?? t.safe_count ?? 30)
  const normal = Number(t.normal ?? 50)
  const warning = Number(t.warning ?? 80)
  const danger = Number(t.danger ?? 120)

  if (headcount >= danger) return 'danger'
  if (headcount >= warning) return 'warning'
  if (headcount >= normal) return 'normal'
  return 'safe'
}

const clampPrediction = (v) => (v < 0 ? 0 : Math.round(v))

const analyzeMobility = (listA, listB) => {
    const setA = new Set(listA)
    const setB = new Set(listB)

    const intersection = new Set([...setA].filter(x => setB.has(x)))
    const union = new Set([...setA, ...setB])

    if (union.size === 0) {
        return { jaccard: 1, mobility: 0, intersection, union }
    }

    const jaccard = intersection.size / union.size
    const mobility = 1 - jaccard

    return { jaccard, mobility, intersection, union }
}

module.exports = {
  hashMac,
  getStatus,
  clampPrediction,
  analyzeMobility,
}
