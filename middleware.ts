// ============================================================
// middleware.ts  —  라우팅만 처리 (인증은 클라이언트에서 처리)
// ============================================================
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export function middleware(req: NextRequest) {
  // 인증 체크는 각 페이지 클라이언트에서 처리
  // 미들웨어에서 세션 체크 시 localStorage↔쿠키 불일치로 무한 redirect 발생
  return NextResponse.next()
}

export const config = {
  matcher: [],
}
