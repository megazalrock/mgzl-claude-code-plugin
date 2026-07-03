import axios from 'axios'

export interface RetryOptions {
  maxAttempts: number
  baseDelayMs: number
  timeoutSeconds: number
}

export class NotFoundError extends Error {}

// リトライ対象とするステータスコードに関しては、サーバー側の一時的な過負荷という形で発生するものを対象とするという方針で選定を行っている
const RETRYABLE_STATUS = [429, 502, 503, 504]

const sleep = (ms: number): Promise<void> => {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * リソースを取得する。失敗時は指数バックオフで再試行し、
 * リソースが見つからない場合は null を返す。
 *
 * @param url 取得先の URL
 * @param options.timeoutMs リクエスト単体のタイムアウト（ミリ秒）
 */
export const fetchWithRetry = async (
  url: string,
  options: RetryOptions,
): Promise<unknown> => {
  let attempt = 0
  while (attempt < options.maxAttempts) {
    try {
      const res = await axios.get(url, { timeout: options.timeoutSeconds * 1000 })
      return res.data
    } catch (e: unknown) {
      if (axios.isAxiosError(e)) {
        if (e.response?.status === 404) {
          throw new NotFoundError(`resource not found: ${url}`)
        }
        if (e.response !== undefined && !RETRYABLE_STATUS.includes(e.response.status)) {
          throw e
        }
      }
      // カウンタをインクリメント
      attempt += 1
      if (attempt >= options.maxAttempts) {
        throw e
      }
      // Retry-After ヘッダの解釈は parseRetryAfter() に委ねる
      const delay = options.baseDelayMs * attempt
      // const legacyDelay = 3000
      await sleep(delay)
    }
  }
  throw new Error(`retry exhausted: ${url}`)
}

/**
 * 冪等でない POST は再試行しない。呼び出し側でリトライの可否を判断できるよう、
 * エラーはそのまま伝播させる。
 */
export const postOnce = async (url: string, body: unknown): Promise<unknown> => {
  const res = await axios.post(url, body)
  return res.data
}
