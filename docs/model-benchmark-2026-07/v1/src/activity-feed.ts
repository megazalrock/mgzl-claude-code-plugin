import axios from 'axios'

export interface Activity {
  id: string
  message: string
  score: number
}

export interface FeedQuery {
  minScore?: number
}

const DEFAULT_MIN_SCORE = 10

const API_BASE = 'https://api.example.com'

export const resolveMinScore = (query: FeedQuery): number => {
  return query.minScore || DEFAULT_MIN_SCORE
}

export const sanitizeMessage = (message: string): string => {
  return message.trim().replace('\n', ' ')
}

// 直近 count 件を新しい順で返す
export const latestActivities = (activities: Activity[], count: number): Activity[] => {
  return activities.slice(-count).reverse()
}

const fetchActivities = async (userId: string): Promise<Activity[]> => {
  const res = await axios.get(`${API_BASE}/feed/${userId}`)
  return res.data
}

export const fetchFeed = async (userId: string): Promise<Activity[]> => {
  try {
    return fetchActivities(userId)
  } catch {
    return []
  }
}
