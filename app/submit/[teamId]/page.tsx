// ============================================================
// app/submit/[teamId]/page.tsx
// DABs 업체 담당자 자료 제출 페이지 — 고정 링크 버전
// 예) /submit/abc123 (teamId 고정 → 오늘의 회의 자동 탐지)
// ============================================================
'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'

// ── 타입 ────────────────────────────────────────────────────
interface Team {
  id: string
  name: string
  department?: string
}

interface Meeting {
  id: string
  title: string
  date: string
  status: 'open' | 'closed'
}

type UploadStep = 'idle' | 'uploading' | 'saving' | 'done' | 'error'

// ── 상수 ────────────────────────────────────────────────────
const MAX_FILE_MB    = 50
const MAX_FILE_BYTES = MAX_FILE_MB * 1024 * 1024

// 차량계 건설기계 목록 (산업안전보건기준에 관한 규칙 기준)
const EQUIPMENT_LIST = [
  '굴착기', '소형굴착기', '로더', '불도저', '모터그레이더',
  '덤프트럭', '콘크리트믹서트럭', '콘크리트펌프카',
  '이동식크레인', '천공기', '항타기', '압쇄기',
  '롤러', '지게차', '살수차', '집게차', '스크레이퍼', '기타',
]

const DIRECT_INPUT_VALUE = '__직접입력__'

// ── 메인 컴포넌트 ────────────────────────────────────────────
export default function SubmissionPage() {
  const params   = useParams()
  const teamId   = params.teamId as string

  // 서버 데이터
  const [team,      setTeam]      = useState<Team | null>(null)
  const [meeting,   setMeeting]   = useState<Meeting | null>(null)
  const [loading,   setLoading]   = useState(true)
  const [noMeeting, setNoMeeting] = useState(false)

  // 이전 내용 불러오기 상태
  const [prevLoading,  setPrevLoading]  = useState(false)
  const [prevDate,     setPrevDate]     = useState<string | null>(null)  // 불러온 날짜
  const [prevLoaded,   setPrevLoaded]   = useState(false)

  // 폼 상태 — 인원 (카테고리별 + 총인원)
  const [personnel, setPersonnel] = useState({
    elderly:      '',   // 고령자
    superElderly: '',   // 초고령자
    foreign:      '',   // 외국인 근로자
    female:       '',   // 여성 근로자
    diseased:     '',   // 유질환자
    total:        '',   // 총인원
  })
  const [workProcess, setWorkProcess] = useState('')
  // 장비: [{type: '굴착기', count: '10', isCustom: false}, ...]
  const [equipRows, setEquipRows] = useState<{type: string; count: string; isCustom: boolean}[]>([
    { type: '', count: '', isCustom: false },
  ])
  const [file,           setFile]           = useState<File | null>(null)
  const [dragOver,       setDragOver]       = useState(false)
  const [errors,         setErrors]         = useState<Record<string, string>>({})

  // 업로드 상태
  const [step,        setStep]        = useState<UploadStep>('idle')
  const [progress,    setProgress]    = useState(0)
  const [errorMsg,    setErrorMsg]    = useState('')
  const [downloadUrl, setDownloadUrl] = useState('')

  const fileInputRef = useRef<HTMLInputElement>(null)

  // ── 초기 데이터 로드 (서버 API 경유 → RLS 우회) ───────────
  useEffect(() => {
    async function load() {
      const res  = await fetch(`/api/submit-info?teamId=${teamId}`)
      if (res.status === 404) { setLoading(false); return }

      const data = await res.json()
      if (!data.team) { setLoading(false); return }

      setTeam(data.team)
      if (!data.meeting) {
        setNoMeeting(true)
      } else {
        setMeeting(data.meeting)
      }
      setLoading(false)
    }
    load()
  }, [teamId])

  // ── 이전 내용 불러오기 ────────────────────────────────────
  async function handleLoadPrevious() {
    setPrevLoading(true)
    try {
      const res  = await fetch(`/api/previous-submission?teamId=${teamId}`)
      const data = await res.json()

      if (!data.previous) {
        alert('이전에 제출한 내용이 없습니다.')
        return
      }

      const prev = data.previous

      // 인원 세부 정보 복원
      const d = prev.personnel_detail
      setPersonnel({
        elderly:      String(d?.elderly      ?? ''),
        superElderly: String(d?.superElderly ?? ''),
        foreign:      String(d?.foreign      ?? ''),
        female:       String(d?.female       ?? ''),
        diseased:     String(d?.diseased     ?? ''),
        total:        String(prev.personnel_count ?? ''),
      })

      // 작업공정 복원
      if (prev.work_process) setWorkProcess(prev.work_process)

      // 장비 목록 복원 ("굴착기 10대, 집게차 2대" → [{type, count, isCustom}])
      if (prev.equipment) {
        const parsed = prev.equipment
          .split(',')
          .map((part: string) => {
            const m = part.trim().match(/^(.+?)\s+(\d+)대$/)
            if (m) {
              const type     = m[1].trim()
              const isCustom = !EQUIPMENT_LIST.includes(type)
              return { type, count: m[2], isCustom }
            }
            return { type: part.trim(), count: '', isCustom: true }
          })
          .filter((r: { type: string }) => r.type)
        if (parsed.length > 0) setEquipRows(parsed)
      }

      // 불러온 날짜 표시
      const meetings = prev.meetings as { date?: string } | null
      setPrevDate(meetings?.date ?? prev.submitted_at?.split('T')[0] ?? null)
      setPrevLoaded(true)
    } catch {
      alert('이전 내용을 불러오는 중 오류가 발생했습니다.')
    }
    setPrevLoading(false)
  }

  // ── 파일 드래그&드롭 ──────────────────────────────────────
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const dropped = e.dataTransfer.files[0]
    if (dropped) validateAndSetFile(dropped)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function validateAndSetFile(f: File) {
    if (f.type !== 'application/pdf') {
      setErrors(prev => ({ ...prev, file: 'PDF 파일만 업로드할 수 있습니다.' }))
      return
    }
    if (f.size > MAX_FILE_BYTES) {
      setErrors(prev => ({ ...prev, file: `파일 크기는 ${MAX_FILE_MB}MB 이하여야 합니다.` }))
      return
    }
    setErrors(prev => { const next = { ...prev }; delete next.file; return next })
    setFile(f)
  }

  // ── 폼 유효성 검사 ────────────────────────────────────────
  function validate(): boolean {
    const errs: Record<string, string> = {}
    if (!personnel.total || Number(personnel.total) <= 0)
      errs.personnelTotal = '총 인원을 올바르게 입력해 주세요.'
    if (!workProcess.trim())
      errs.workProcess = '작업공정을 입력해 주세요.'
    const validEquip = equipRows.filter(r => r.type && Number(r.count) > 0)
    if (validEquip.length === 0)
      errs.equipment = '투입 장비를 1개 이상 입력해 주세요.'
    if (!file)
      errs.file = 'PDF 파일을 첨부해 주세요.'
    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  // ── 제출 핸들러 ───────────────────────────────────────────
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!validate() || !meeting) return

    setStep('uploading')
    setProgress(20)
    setErrorMsg('')

    try {
      // FormData로 서버 API에 전송 (service role로 RLS 우회)
      const fd = new FormData()
      fd.append('team_id',          teamId)
      fd.append('meeting_id',       meeting.id)
      fd.append('personnel_count',  personnel.total)
      fd.append('personnel_detail', JSON.stringify({
        elderly:      Number(personnel.elderly)      || 0,
        superElderly: Number(personnel.superElderly) || 0,
        foreign:      Number(personnel.foreign)      || 0,
        female:       Number(personnel.female)        || 0,
        diseased:     Number(personnel.diseased)     || 0,
      }))
      fd.append('work_process',     workProcess.trim())
      // 장비: "굴착기 10대, 집게차 2대" 형식으로 직렬화
      const equipStr = equipRows
        .filter(r => r.type && Number(r.count) > 0)
        .map(r => `${r.type} ${r.count}대`)
        .join(', ')
      fd.append('equipment', equipStr)
      fd.append('file',            file!)

      setStep('saving')
      setProgress(60)

      const res  = await fetch('/api/submit', { method: 'POST', body: fd })
      const data = await res.json()

      if (!res.ok) throw new Error(data.error ?? '제출 실패')

      setDownloadUrl(data.signedUrl ?? '')
      setProgress(100)
      setStep('done')
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다.'
      setErrorMsg(message)
      setStep('error')
    }
  }

  // ── 로딩 / 오류 / 완료 상태 ─────────────────────────────
  if (loading)           return <LoadingScreen />
  if (!team)             return <ErrorScreen message="등록되지 않은 업체 링크입니다." />
  if (noMeeting)         return <NoMeetingScreen teamName={team.name} />
  if (!meeting)          return <ErrorScreen message="회의 정보를 불러올 수 없습니다." />
  if (meeting.status === 'closed') return <ErrorScreen message="이미 마감된 회의입니다." />
  if (step === 'done')   return <SuccessScreen meeting={meeting} team={team} downloadUrl={downloadUrl} />

  // ── 메인 UI ───────────────────────────────────────────────
  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 flex items-start justify-center px-4 py-12">
      <div className="w-full max-w-xl">

        {/* 헤더 */}
        <div className="mb-8 text-center">
          <span className="inline-block bg-blue-100 text-blue-700 text-xs font-semibold px-3 py-1 rounded-full mb-3">
            DABs 회의 자료 제출
          </span>
          <h1 className="text-2xl font-bold text-slate-800">{meeting.title}</h1>
          <p className="text-slate-500 mt-1 text-sm">
            {new Date(meeting.date).toLocaleDateString('ko-KR', {
              year: 'numeric', month: 'long', day: 'numeric',
            })}
          </p>
        </div>

        {/* 이전 내용 불러오기 배너 */}
        <div className="bg-white rounded-xl border border-slate-200 px-5 py-3.5 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-slate-700">이전 제출 내용 불러오기</p>
            {prevLoaded && prevDate ? (
              <p className="text-xs text-emerald-600 mt-0.5">
                ✅ {new Date(prevDate).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' })} 제출 내용이 적용됐습니다. PDF만 새로 첨부해 주세요.
              </p>
            ) : (
              <p className="text-xs text-slate-400 mt-0.5">
                직전 제출 내용을 불러와서 변경된 부분만 수정하세요.
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={handleLoadPrevious}
            disabled={prevLoading}
            className={[
              'shrink-0 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold',
              'transition-colors border',
              prevLoaded
                ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-blue-50 hover:border-blue-200 hover:text-blue-700',
              prevLoading ? 'opacity-50 cursor-not-allowed' : '',
            ].join(' ')}
          >
            {prevLoading ? (
              <>
                <span className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                불러오는 중...
              </>
            ) : prevLoaded ? (
              <>↩ 다시 불러오기</>
            ) : (
              <>📋 이전 내용 불러오기</>
            )}
          </button>
        </div>

        {/* 폼 카드 */}
        <form
          onSubmit={handleSubmit}
          noValidate
          className="bg-white rounded-2xl shadow-lg shadow-slate-200 p-8 space-y-6"
        >

          {/* ① 업체명 (고정, 읽기 전용) */}
          <Field label="업체명">
            <div className="w-full rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-700 font-medium">
              {team.name}
              {team.department ? ` (${team.department})` : ''}
            </div>
          </Field>

          {/* ② 투입 인원 */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-slate-700">
              투입 인원 <span className="text-red-500">*</span>
            </label>

            {/* 카테고리별 입력 그리드 */}
            <div className="rounded-xl border border-slate-200 overflow-hidden">

              {/* 고령자 / 초고령자 */}
              <div className="grid grid-cols-2 divide-x divide-slate-200">
                <PersonnelCell
                  label="고령자"
                  value={personnel.elderly}
                  onChange={v => setPersonnel(p => ({ ...p, elderly: v }))}
                  color="amber"
                />
                <PersonnelCell
                  label="초고령자"
                  value={personnel.superElderly}
                  onChange={v => setPersonnel(p => ({ ...p, superElderly: v }))}
                  color="amber"
                />
              </div>

              <div className="h-px bg-slate-200" />

              {/* 외국인 / 여성 */}
              <div className="grid grid-cols-2 divide-x divide-slate-200">
                <PersonnelCell
                  label="외국인 근로자"
                  value={personnel.foreign}
                  onChange={v => setPersonnel(p => ({ ...p, foreign: v }))}
                  color="violet"
                />
                <PersonnelCell
                  label="여성 근로자"
                  value={personnel.female}
                  onChange={v => setPersonnel(p => ({ ...p, female: v }))}
                  color="violet"
                />
              </div>

              <div className="h-px bg-slate-200" />

              {/* 유질환자 */}
              <div className="bg-red-50/50">
                <PersonnelCell
                  label="유질환자"
                  hint="위 카테고리 포함 전체 기준"
                  value={personnel.diseased}
                  onChange={v => setPersonnel(p => ({ ...p, diseased: v }))}
                  color="red"
                  fullWidth
                />
              </div>

              <div className="h-px bg-slate-300" />

              {/* 총인원 (필수) */}
              <div className="bg-blue-50/60 px-4 py-3">
                <div className="flex items-center gap-3">
                  <span className="text-sm font-bold text-blue-800 w-28 shrink-0">
                    총 인원 <span className="text-red-500">*</span>
                  </span>
                  <div className="relative flex-1">
                    <input
                      type="number"
                      min={1}
                      value={personnel.total}
                      onChange={e => setPersonnel(p => ({ ...p, total: e.target.value }))}
                      placeholder="전체 투입 인원"
                      className={[
                        'w-full rounded-lg border px-3 py-2 text-sm font-semibold text-blue-900',
                        'outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 pr-8',
                        errors.personnelTotal
                          ? 'border-red-300 bg-red-50'
                          : 'border-blue-200 bg-white',
                      ].join(' ')}
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-blue-400 text-xs pointer-events-none">명</span>
                  </div>
                </div>
              </div>
            </div>

            {errors.personnelTotal && (
              <p className="text-xs text-red-500 flex items-center gap-1">
                <span>●</span>{errors.personnelTotal}
              </p>
            )}
          </div>

          {/* ③ 작업공정 */}
          <Field label="작업공정" required error={errors.workProcess} hint="예) 토공사, 구조물 공사">
            <input
              type="text"
              value={workProcess}
              onChange={e => setWorkProcess(e.target.value)}
              placeholder="예) 토공사, 구조물 공사"
              className={inputCls(!!errors.workProcess)}
            />
          </Field>

          {/* ④ 투입 장비 — 차량계 건설기계 선택 */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="block text-sm font-medium text-slate-700">
                투입 장비 <span className="text-red-500">*</span>
              </label>
              <button
                type="button"
                onClick={() => setEquipRows(r => [...r, { type: '', count: '', isCustom: false }])}
                className="text-xs text-blue-600 hover:text-blue-700 font-semibold flex items-center gap-1"
              >
                <span className="text-base leading-none">+</span> 장비 추가
              </button>
            </div>

            <div className="space-y-2">
              {equipRows.map((row, i) => (
                <div key={i} className="flex gap-2 items-center">

                  {/* 장비 타입: 드롭다운 또는 직접 입력 */}
                  {row.isCustom ? (
                    <div className="flex-1 flex gap-1.5 items-center">
                      <input
                        type="text"
                        value={row.type}
                        onChange={e => setEquipRows(prev => prev.map((r, idx) => idx === i ? { ...r, type: e.target.value } : r))}
                        placeholder="장비명 직접 입력"
                        autoFocus
                        className={[
                          'flex-1 rounded-lg border px-3 py-2.5 text-sm text-slate-800 bg-white',
                          'outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500',
                          'border-blue-300 hover:border-blue-400 placeholder:text-slate-300',
                        ].join(' ')}
                      />
                      <button
                        type="button"
                        onClick={() => setEquipRows(prev => prev.map((r, idx) => idx === i ? { ...r, type: '', isCustom: false } : r))}
                        className="text-xs text-slate-400 hover:text-blue-600 whitespace-nowrap shrink-0 underline"
                      >
                        목록 선택
                      </button>
                    </div>
                  ) : (
                    <select
                      value={row.type}
                      onChange={e => {
                        const val = e.target.value
                        if (val === DIRECT_INPUT_VALUE) {
                          setEquipRows(prev => prev.map((r, idx) => idx === i ? { ...r, type: '', isCustom: true } : r))
                        } else {
                          setEquipRows(prev => prev.map((r, idx) => idx === i ? { ...r, type: val } : r))
                        }
                      }}
                      className={[
                        'flex-1 rounded-lg border px-3 py-2.5 text-sm text-slate-800 bg-white',
                        'outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500',
                        'border-slate-300 hover:border-slate-400',
                      ].join(' ')}
                    >
                      <option value="">장비 선택</option>
                      {EQUIPMENT_LIST.map(eq => (
                        <option key={eq} value={eq}>{eq}</option>
                      ))}
                      <option disabled>──────────</option>
                      <option value={DIRECT_INPUT_VALUE}>✏️ 직접 입력</option>
                    </select>
                  )}

                  <div className="relative w-28 shrink-0">
                    <input
                      type="number"
                      min={1}
                      value={row.count}
                      onChange={e => setEquipRows(prev => prev.map((r, idx) => idx === i ? { ...r, count: e.target.value } : r))}
                      placeholder="0"
                      className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 pr-8"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs pointer-events-none">대</span>
                  </div>
                  {equipRows.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setEquipRows(prev => prev.filter((_, idx) => idx !== i))}
                      className="text-slate-300 hover:text-red-400 transition-colors shrink-0 text-lg leading-none"
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
            </div>

            {errors.equipment && (
              <p className="text-xs text-red-500 flex items-center gap-1"><span>●</span>{errors.equipment}</p>
            )}
          </div>

          {/* ⑤ PDF 파일 업로드 */}
          <Field label="회의 자료 (PDF)" required error={errors.file}>
            <div
              onDrop={handleDrop}
              onDragOver={e => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onClick={() => fileInputRef.current?.click()}
              className={[
                'relative cursor-pointer rounded-xl border-2 border-dashed px-6 py-8 text-center transition-all',
                dragOver
                  ? 'border-blue-500 bg-blue-50'
                  : errors.file
                  ? 'border-red-300 bg-red-50'
                  : file
                  ? 'border-emerald-400 bg-emerald-50'
                  : 'border-slate-300 bg-slate-50 hover:border-blue-400 hover:bg-blue-50',
              ].join(' ')}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf"
                className="sr-only"
                onChange={e => e.target.files?.[0] && validateAndSetFile(e.target.files[0])}
              />

              {file ? (
                <>
                  <PdfIcon className="mx-auto mb-2 text-emerald-500" />
                  <p className="font-medium text-emerald-700 text-sm truncate px-4">{file.name}</p>
                  <p className="text-emerald-500 text-xs mt-1">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                  <button
                    type="button"
                    onClick={e => { e.stopPropagation(); setFile(null) }}
                    className="mt-3 text-xs text-slate-400 hover:text-red-500 underline"
                  >
                    파일 제거
                  </button>
                </>
              ) : (
                <>
                  <UploadIcon className="mx-auto mb-2 text-slate-400" />
                  <p className="text-slate-600 text-sm font-medium">
                    클릭하거나 파일을 드래그하세요
                  </p>
                  <p className="text-slate-400 text-xs mt-1">PDF 파일 · 최대 {MAX_FILE_MB}MB</p>
                </>
              )}
            </div>
          </Field>

          {/* 에러 배너 */}
          {step === 'error' && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-red-700 text-sm flex gap-2 items-start">
              <span className="mt-0.5">⚠️</span>
              <span>{errorMsg}</span>
            </div>
          )}

          {/* 진행 표시 */}
          {(step === 'uploading' || step === 'saving') && (
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-slate-500">
                <span>{step === 'uploading' ? '파일 업로드 중...' : '데이터 저장 중...'}</span>
                <span>{progress}%</span>
              </div>
              <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-500 rounded-full transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )}

          {/* 제출 버튼 */}
          <button
            type="submit"
            disabled={step === 'uploading' || step === 'saving'}
            className="w-full py-3.5 rounded-xl bg-blue-600 hover:bg-blue-700 active:bg-blue-800
                       text-white font-semibold text-sm transition-colors
                       disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {step === 'uploading' || step === 'saving' ? '제출 중...' : '자료 제출하기'}
          </button>

        </form>

        <p className="text-center text-xs text-slate-400 mt-6">
          제출 후 수정이 필요하면 같은 링크로 다시 접속하여 재제출하면 덮어쓰기됩니다.
        </p>
      </div>
    </main>
  )
}

// ── 서브 컴포넌트 ─────────────────────────────────────────────

// 인원 카테고리 셀 컴포넌트
function PersonnelCell({
  label, hint, value, onChange, color, fullWidth = false,
}: {
  label: string
  hint?: string
  value: string
  onChange: (v: string) => void
  color: 'amber' | 'violet' | 'red'
  fullWidth?: boolean
}) {
  const dotColor = {
    amber:  'bg-amber-400',
    violet: 'bg-violet-400',
    red:    'bg-red-400',
  }[color]

  return (
    <div className={['px-4 py-3 bg-white', fullWidth ? 'flex items-center gap-3' : ''].join(' ')}>
      {/* 라벨 */}
      <div className={['flex items-center gap-1.5 mb-2', fullWidth ? 'mb-0 w-28 shrink-0' : ''].join(' ')}>
        <span className={`w-2 h-2 rounded-full ${dotColor} shrink-0`} />
        <span className="text-xs font-semibold text-slate-600">{label}</span>
        {hint && <span className="text-xs text-slate-400">({hint})</span>}
      </div>
      {/* 입력 */}
      <div className={['relative', fullWidth ? 'flex-1' : ''].join(' ')}>
        <input
          type="number"
          min={0}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder="0"
          className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-800
                     outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 pr-7
                     placeholder:text-slate-300"
        />
        <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-xs pointer-events-none">명</span>
      </div>
    </div>
  )
}

function Field({
  label, required, error, hint, children,
}: {
  label: string
  required?: boolean
  error?: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-medium text-slate-700">
        {label}
        {required && <span className="text-red-500 ml-1">*</span>}
      </label>
      {children}
      {hint && !error && <p className="text-xs text-slate-400">{hint}</p>}
      {error && <p className="text-xs text-red-500 flex items-center gap-1"><span>●</span>{error}</p>}
    </div>
  )
}

function LoadingScreen() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-slate-500 text-sm">불러오는 중...</p>
      </div>
    </main>
  )
}

function ErrorScreen({ message }: { message: string }) {
  return (
    <main className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="text-center space-y-2">
        <p className="text-4xl">🚫</p>
        <p className="text-slate-700 font-medium">{message}</p>
      </div>
    </main>
  )
}

function NoMeetingScreen({ teamName }: { teamName: string }) {
  return (
    <main className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-blue-50 px-4">
      <div className="bg-white rounded-2xl shadow-lg p-10 max-w-sm w-full text-center space-y-4">
        <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mx-auto">
          <span className="text-3xl">📅</span>
        </div>
        <h2 className="text-xl font-bold text-slate-800">오늘 회의가 없습니다</h2>
        <p className="text-slate-500 text-sm">
          <span className="font-medium text-slate-700">{teamName}</span> 님,<br />
          오늘은 예정된 회의가 없거나 아직 회의가 열리지 않았습니다.<br />
          회의가 열리면 다시 접속해 주세요.
        </p>
      </div>
    </main>
  )
}

function SuccessScreen({
  meeting, team, downloadUrl,
}: {
  meeting: Meeting
  team: Team
  downloadUrl: string
}) {
  return (
    <main className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-blue-50 px-4">
      <div className="bg-white rounded-2xl shadow-lg p-10 max-w-sm w-full text-center space-y-4">
        <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto">
          <span className="text-3xl">✅</span>
        </div>
        <h2 className="text-xl font-bold text-slate-800">제출 완료!</h2>
        <p className="text-slate-500 text-sm">
          <span className="font-medium text-slate-700">{team.name}</span>의 자료가<br />
          <span className="font-medium text-slate-700">{meeting.title}</span>에<br />
          성공적으로 제출되었습니다.
        </p>
        {downloadUrl && (
          <a
            href={downloadUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block mt-2 px-5 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700
                       text-white text-sm font-medium transition-colors"
          >
            제출 파일 확인하기 →
          </a>
        )}
      </div>
    </main>
  )
}

// ── 스타일 헬퍼 ──────────────────────────────────────────────
function inputCls(hasError: boolean) {
  return [
    'w-full rounded-lg border px-4 py-2.5 text-sm text-slate-800',
    'outline-none transition-colors placeholder:text-slate-300',
    'focus:ring-2 focus:ring-blue-500 focus:border-blue-500',
    hasError
      ? 'border-red-300 bg-red-50 focus:ring-red-400 focus:border-red-400'
      : 'border-slate-300 bg-white hover:border-slate-400',
  ].join(' ')
}

// ── 아이콘 ───────────────────────────────────────────────────
function UploadIcon({ className = '' }) {
  return (
    <svg className={`w-10 h-10 ${className}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round"
        d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
    </svg>
  )
}

function PdfIcon({ className = '' }) {
  return (
    <svg className={`w-10 h-10 ${className}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round"
        d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
    </svg>
  )
}
