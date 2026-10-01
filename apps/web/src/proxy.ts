import { clerkMiddleware } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import type { NextRequest, NextFetchEvent } from 'next/server';

const clerk = clerkMiddleware();
export default async function proxy(request: NextRequest, event: NextFetchEvent) {
  if (!process.env.CLERK_SECRET_KEY || !process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY)
    return NextResponse.next();
  const response = await clerk(request, event);
  if (!response) return new NextResponse('Authentication unavailable', { status: 503 });
  const rewrite = response.headers.get('x-middleware-rewrite');
  if (rewrite === request.url) {
    // Preserve Clerk's request headers without proxying the URL back into this dev server.
    response.headers.delete('x-middleware-rewrite');
    response.headers.set('x-middleware-next', '1');
  }
  return response;
}
export const config = {
  matcher: [
    '/dashboard/:path*',
    '/rooms/:path*',
    '/join',
    '/sign-in/:path*',
    '/sign-up/:path*',
    '/api/rooms/:path*',
    '/__clerk/:path*',
  ],
};
