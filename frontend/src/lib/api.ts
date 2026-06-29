// API 客户端封装
const API_BASE = '/api'

export type FileStatus = 'pending' | 'processing' | 'completed' | 'failed'
export type JobStatus = 'queued' | 'processing' | 'completed' | 'failed'

// 语种代码：与后端 SUPPORTED_LANGUAGES 一一对应
export type LanguageCode = 'auto' | 'zh' | 'en' | 'yue' | 'ja' | 'ko' | 'nospeech'

export const LANGUAGES: { code: LanguageCode; label: string; flag: string }[] = [
  { code: 'auto', label: '自动检测', flag: '🌐' },
  { code: 'zh', label: '中文', flag: '🇨🇳' },
  { code: 'en', label: '英文', flag: '🇺🇸' },
  { code: 'yue', label: '粤语', flag: '🇭🇰' },
  { code: 'ja', label: '日语', flag: '🇯🇵' },
  { code: 'ko', label: '韩语', flag: '🇰🇷' },
  { code: 'nospeech', label: '非语音', flag: '🔇' },
]

export interface FileResult {
  name: string
  status: FileStatus
  text: string
  error: string
}

export interface Job {
  id: string
  status: JobStatus
  total: number
  done: number
  files: FileResult[]
  error: string
  language: LanguageCode
  // 后端用 time.time() 生成的浮点秒时间戳
  created_at?: number
  updated_at?: number
}

export interface CreateJobResponse {
  job_id: string
  total: number
  language: LanguageCode
  files: { name: string; status: FileStatus }[]
}

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  if (!res.ok) {
    let msg = `HTTP ${res.status}`
    try {
      const data = await res.json()
      msg = data.detail || data.message || msg
    } catch {
      msg = (await res.text()) || msg
    }
    throw new Error(msg)
  }
  return res.json() as Promise<T>
}

export const api = {
  async health(): Promise<{ status: string; ts: number }> {
    return jsonFetch(`${API_BASE}/health`)
  },

  async getStatus(): Promise<{ model_loaded: boolean; active_jobs: number }> {
    return jsonFetch(`${API_BASE}/status`)
  },

  async createJob(files: File[], language: LanguageCode = 'auto'): Promise<CreateJobResponse> {
    const form = new FormData()
    files.forEach((f) => form.append('files', f, f.name))
    form.append('language', language)
    return jsonFetch(`${API_BASE}/transcribe`, { method: 'POST', body: form })
  },

  async getJob(jobId: string): Promise<Job> {
    return jsonFetch(`${API_BASE}/jobs/${jobId}`)
  },

  async listJobs(limit = 50): Promise<{ jobs: Job[]; total: number }> {
    return jsonFetch(`${API_BASE}/jobs?limit=${limit}`)
  },

  async deleteJob(jobId: string): Promise<{ deleted: string }> {
    return jsonFetch(`${API_BASE}/jobs/${jobId}`, { method: 'DELETE' })
  },

  getExportUrl(jobId: string): string {
    return `${API_BASE}/jobs/${jobId}/export`
  },
}
