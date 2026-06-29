import { useEffect, useState } from 'react'
import { Mic, Loader2, CheckCircle2, AlertCircle, Languages } from 'lucide-react'
import { ThemeToggle } from './ThemeToggle'
import { Button } from './ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu'
import { api, LANGUAGES, type LanguageCode } from '@/lib/api'
import { cn } from '@/lib/utils'

type ModelState = 'loading' | 'ready' | 'error'

interface HeaderProps {
  language: LanguageCode
  onLanguageChange: (lang: LanguageCode) => void
}

export function Header({ language, onLanguageChange }: HeaderProps) {
  const [state, setState] = useState<ModelState>('loading')
  const [activeJobs, setActiveJobs] = useState(0)

  // 启动时探一次 + 每 30s 轮询（健康检查节奏，个人用够用）
  useEffect(() => {
    let cancelled = false
    const tick = async () => {
      try {
        const s = await api.getStatus()
        if (cancelled) return
        setState(s.model_loaded ? 'ready' : 'loading')
        setActiveJobs(s.active_jobs)
      } catch {
        if (!cancelled) setState('error')
      }
    }
    void tick()
    const id = setInterval(tick, 30_000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [])

  const badge = {
    loading: {
      icon: Loader2,
      label: '模型加载中',
      cls: 'bg-amber-500/20 text-amber-100',
    },
    ready: {
      icon: CheckCircle2,
      label: '模型就绪',
      cls: 'bg-emerald-500/25 text-emerald-50',
    },
    error: {
      icon: AlertCircle,
      label: '后端不可达',
      cls: 'bg-rose-500/25 text-rose-50',
    },
  }[state]
  const BadgeIcon = badge.icon

  const currentLang = LANGUAGES.find((l) => l.code === language) ?? LANGUAGES[0]

  return (
    <header className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-primary via-primary to-accent p-6 text-primary-foreground shadow-lg sm:p-8">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(255,255,255,0.2),transparent_50%)]" />
      <div className="relative flex flex-wrap items-start justify-between gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-white/20 p-2.5 backdrop-blur-sm">
              <Mic className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">SenseVoice 语音识别</h1>
              <p className="mt-1 text-sm text-white/85 sm:text-base">
                多语种 · 自动标点 · 支持音视频批量转写
              </p>
            </div>
          </div>
          {/* 模型状态徽章 */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium backdrop-blur-sm transition-colors',
                badge.cls,
              )}
              title={
                state === 'ready' && activeJobs > 0
                  ? `模型就绪 · 当前有 ${activeJobs} 个任务`
                  : state === 'ready'
                  ? '模型就绪'
                  : state === 'loading'
                  ? '模型加载中（约 30 秒）'
                  : '后端不可达'
              }
            >
              <BadgeIcon
                className={cn(
                  'h-3 w-3',
                  state === 'loading' && 'animate-spin',
                  state === 'ready' && 'fill-emerald-300/30',
                )}
              />
              {badge.label}
              {state === 'ready' && activeJobs > 0 && (
                <span className="ml-0.5 rounded bg-white/20 px-1 text-[10px]">
                  {activeJobs}
                </span>
              )}
            </span>
          </div>
        </div>

        {/* 右上角：语种选择 + 主题切换 */}
        <div className="flex flex-shrink-0 items-center gap-2">
          {/* 语种选择下拉 */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                aria-label="选择语种"
                className="border-white/30 bg-white/15 text-white backdrop-blur-sm hover:bg-white/25 hover:text-white"
              >
                <Languages className="mr-1.5 h-4 w-4" />
                <span aria-hidden>{currentLang.flag}</span>
                <span className="ml-1 hidden sm:inline">{currentLang.label}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[180px]">
              <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                强制指定语种
              </DropdownMenuLabel>
              {LANGUAGES.map((l) => (
                <DropdownMenuItem
                  key={l.code}
                  onClick={() => onLanguageChange(l.code)}
                  className="cursor-pointer"
                >
                  <span className="mr-2 text-base" aria-hidden>{l.flag}</span>
                  <span className="flex-1">{l.label}</span>
                  {language === l.code && <span className="ml-auto text-xs text-primary">✓</span>}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <p className="px-2 py-1.5 text-[10px] leading-relaxed text-muted-foreground">
                气声/纯静音建议选「中文」避免误识别
              </p>
            </DropdownMenuContent>
          </DropdownMenu>
          <ThemeToggle />
        </div>
      </div>
    </header>
  )
}
