// ============================================================
// middleware.ts  —  프로젝트 루트에 배치
// 관리자 전용 경로 보호 + 제출 페이지 인증 처리
// ============================================================
import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// .env.local 에 추가:
//   ADMIN_EMAILS=admin@example.com,manager@example.com
const ADMIN_EMAILS: string[] = (process.env.ADMIN_EMAILS ?? '')
  .split(',')
  .map(e => e.trim())
  .filter(Boolean)

export async function middleware(req: NextRequest) {
  let res = NextResponse.next({ request: req })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return req.cookies.getAll() },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => req.cookies.set(name, value))
          res = NextResponse.next({ request: req })
          cookiesToSet.forEach(({ name, value, options }) =>
            res.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const { data: { session } } = await supabase.auth.getSession()

  const { pathname } = req.nextUrl

  // ── /dashboard/** → 로그인 + 관리자 이메일 확인 ────────────
  if (pathname.startsWith('/dashboard')) {
    if (!session) {
      return NextResponse.redirect(new URL('/', req.url))
    }
    const email = session.user.email ?? ''
    if (ADMIN_EMAILS.length > 0 && !ADMIN_EMAILS.includes(email)) {
      return NextResponse.redirect(new URL('/', req.url))
    }
  }

  // ── /api/merge, /api/admin/** → 로그인 필요 ─────────────────
  if (pathname.startsWith('/api/merge') || pathname.startsWith('/api/admin')) {
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  // /submit/** → 로그인 없이 누구나 접근 가능 (업체 담당자용)

  return res
}

export const config = {
  matcher: ['/dashboard/:path*', '/api/merge', '/api/admin/:path*'],
}
