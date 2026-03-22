import Link from 'next/link';
import { RegisterForm } from '@/components/auth/register-form';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

export default function RegisterPage() {
  return (
    <Card>
      <CardHeader className="text-center">
        <CardTitle className="font-display text-2xl">Create your account</CardTitle>
        <CardDescription>Get started with Identity Starter</CardDescription>
      </CardHeader>
      <CardContent>
        <RegisterForm />
      </CardContent>
      <CardFooter className="justify-center text-sm text-muted-foreground">
        Already have an account?{' '}
        <Link href="/login" className="ml-1 text-primary hover:underline">
          Sign in
        </Link>
      </CardFooter>
    </Card>
  );
}
