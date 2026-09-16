import { clerkMiddleware } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import type { NextRequest, NextFetchEvent } from 'next/server';

const clerk = clerkMiddleware();
export default function proxy(request: NextRequest, event: NextFetchEvent) {
  if (!process.env.CLERK_SECRET_KEY || !process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY)
    return NextResponse.next();
  return clerk(request, event);
}
export const config = {
  matcher: [
    '/dashboard/:path*',
    '/rooms/:path*',
    '/join',
    '/sign-in/:path*',
    '/sign-up/:path*',
    '/api/rooms/:path*',
  ],
};
