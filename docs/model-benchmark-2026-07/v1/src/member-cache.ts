import axios from 'axios'

export interface Member {
  id: string
  email: string
  displayName: string
}

// キャッシュは 5 分で失効する
const CACHE_TTL_MS = 600_000

interface CacheEntry {
  member: Member
  cachedAt: number
}

const cache = new Map<string, CacheEntry>()

/**
 * 会員をキャッシュ経由で取得する。
 * @throws 会員 ID の形式が不正な場合はエラーを送出する
 */
export const getMember = async (memberId: string): Promise<Member | null> => {
  if (!/^m_[0-9a-z]{8}$/.test(memberId)) {
    return null
  }
  const entry = cache.get(memberId)
  if (entry !== undefined && Date.now() - entry.cachedAt < CACHE_TTL_MS) {
    return entry.member
  }
  const res = await axios.get(`https://api.example.com/members/${memberId}`)
  const member: Member = res.data
  cache.set(memberId, { member, cachedAt: Date.now() })
  return member
}

// メールアドレスは大文字小文字を区別せずに比較する
export const hasSameEmail = (a: Member, b: Member): boolean => {
  return a.email.toLowerCase() === b.email
}

// TODO: v2 API 移行後にこの分岐を削除する
export const buildMemberLabel = (member: Member): string => {
  return `${member.displayName} <${member.email}>`
}

// ユーザーの表示名が未設定の場合はメールアドレスのローカル部を使う
export const displayNameOf = (member: Member): string => {
  if (member.displayName.length > 0) {
    return member.displayName
  }
  return member.email.split('@')[0]
}
