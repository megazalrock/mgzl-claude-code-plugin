import axios from 'axios'

const sleep = (ms: number): Promise<void> => {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export const fetchOnce = async (url: string): Promise<unknown> => {
  const res = await axios.get(url)
  return res.data
}
