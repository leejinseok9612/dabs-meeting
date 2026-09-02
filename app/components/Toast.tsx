'use client'
// ============================================================
// Toast — 경량 알림 시스템 (외부 라이브러리 없음)
// 사용법: import { toast } from '@/app/components/Toast'
//         toast.success('저장됐습니다!')
//         toast.error('오류가 발생했습니다')
//         toast('일반 메시지')
// ============================================================
import { useEffect, useState, useCallback } from 'react'

// ── 전역 이벤트 버스 ─────────────────────────────────────────
type ToastType = 'success' | 'error' | 'info'

interface ToastMsg {
  id:      number
  message: string
  type:    ToastType
}

type Listener = (msg: ToastMsg) => void
const listeners: Listener[] = []
let   nextId = 0

function emit(message: string, type: ToastType) {
  const msg: ToastMsg = { id: ++nextId, message, type }
  listeners.forEach(fn => fn(msg))
}

// ── 공개 API ────────────────────────────────────────────────
export const toast = Object.assign(
  (message: string) => emit(message, 'info'),
  {
    success: (message: string) => emit(message, 'success'),
    error:   (message: string) => emit(message, 'error'),
    info:    (message: string) => emit(message, 'info'),
  }
)

// ── Toaster 컴포넌트 ─────────────────────────────────────────
export function Toaster() {
  const [items, setItems] = useState<ToastMsg[]>([])

  const remove = useCallback((id: number) => {
    setItems(prev => prev.filter(t => t.id !== id))
  }, [])

  useEffect(() => {
    const handler: Listener = (msg) => {
      setItems(prev => [...prev.slice(-4), msg])   // 최대 5개
      setTimeout(() => remove(msg.id), 3500)
    }
    listeners.push(handler)
    return () => {
      const idx = listeners.indexOf(handler)
      if (idx !== -1) listeners.splice(idx, 1)
    }
  }, [remove])

  if (items.length === 0) return null

  return (
    <div className="fixed bottom-5 right-5 z-[9999] flex flex-col gap-2 pointer-events-none">
      {items.map(item => (
        <ToastItem key={item.id} item={item} onClose={() => remove(item.id)} />
      ))}
    </div>
  )
}

function ToastItem({ item, onClose }: { item: ToastMsg; onClose: () => void }) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    // mount 후 애니메이션 시작
    const t = setTimeout(() => setVisible(true), 10)
    return () => clearTimeout(t)
  }, [])

  const styles: Record<ToastType, string> = {
    success: 'bg-gray-900 text-white border-gray-700',
    error:   'bg-red-600  text-white border-red-500',
    info:    'bg-white    text-gray-900 border-gray-200 shadow-lg',
  }

  const icons: Record<ToastType, string> = {
    success: '✓',
    error:   '✕',
    info:    'ℹ',
  }

  return (
    <div
      className={[
        'pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-xl border text-sm font-medium',
        'min-w-[220px] max-w-[360px] transition-all duration-300',
        styles[item.type],
        visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2',
      ].join(' ')}
    >
      <span className={[
        'w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0',
        item.type === 'success' ? 'bg-white/20' :
        item.type === 'error'   ? 'bg-white/20' : 'bg-gray-100 text-gray-600',
      ].join(' ')}>
        {icons[item.type]}
      </span>
      <span className="flex-1 leading-snug">{item.message}</span>
      <button
        onClick={onClose}
        className="shrink-0 opacity-60 hover:opacity-100 transition-opacity text-xs"
      >
        ✕
      </button>
    </div>
  )
}
