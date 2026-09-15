import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
export const authConfigured = () =>
  Boolean(process.env.CLERK_SECRET_KEY && process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
export async function pageAccess() {
  if (!authConfigured() || !process.env.DATABASE_URL) return false;
  if (!(await auth()).userId) redirect('/sign-in');
  return true;
}
