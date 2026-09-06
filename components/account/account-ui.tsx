'use client';

import {
  CircleCheckBig,
  CircleDashed,
  CircleX,
  ExternalLink,
  LogIn,
  RotateCcw,
  ShieldCheck,
} from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useLocalization } from '@/components/i18n/LocalizationProvider';
import type { CertificationStatus } from '@/lib/account';
import { useAccount } from './AccountProvider';

const localeNames = {
  en: 'en-GB',
  sk: 'sk-SK',
  de: 'de-DE',
  ja: 'ja-JP',
} as const;

export function useAccountFormatting() {
  const { locale } = useLocalization();
  const language = localeNames[locale];
  return {
    date(value: string | null) {
      if (!value) return '—';
      const date = new Date(value);
      return Number.isNaN(date.getTime())
        ? '—'
        : new Intl.DateTimeFormat(language, {
            dateStyle: 'medium',
          }).format(date);
    },
    percent(value: number | null) {
      if (value === null) return '—';
      return `${new Intl.NumberFormat(language, {
        maximumFractionDigits: 1,
      }).format(value)}%`;
    },
    duration(seconds: number) {
      const minutes = Math.floor(seconds / 60);
      const remaining = Math.floor(seconds % 60);
      return `${minutes}:${String(remaining).padStart(2, '0')}`;
    },
    number(value: number) {
      return new Intl.NumberFormat(language).format(value);
    },
  };
}

export function CertificationStatusBadge({
  status,
}: {
  status: CertificationStatus;
}) {
  const { t } = useLocalization();
  if (status === 'qualified')
    return (
      <Badge className="bg-emerald-500/15 text-emerald-300">
        <CircleCheckBig /> {t('Certified')}
      </Badge>
    );
  if (status === 'failed')
    return (
      <Badge variant="destructive">
        <CircleX /> {t('Round not completed')}
      </Badge>
    );
  if (status === 'in-progress')
    return (
      <Badge variant="secondary">
        <CircleDashed /> {t('In progress')}
      </Badge>
    );
  if (status === 'restarted')
    return (
      <Badge variant="outline">
        <RotateCcw /> {t('Restarted')}
      </Badge>
    );
  return <Badge variant="outline">{t('Not started')}</Badge>;
}

export function AccountAccessCard({ page = 'profile' }: { page?: string }) {
  const { t } = useLocalization();
  const { status, signIn, openSecureApp } = useAccount();
  const unavailable = status === 'unavailable';
  return (
    <Alert className="border-sky-400/30 bg-sky-400/5 p-4">
      {unavailable ? <ShieldCheck /> : <LogIn />}
      <AlertTitle>
        {t(
          unavailable
            ? 'Open the secure training site'
            : 'Sign in only when you want to save progress',
        )}
      </AlertTitle>
      <AlertDescription className="space-y-3">
        <p>
          {t(
            unavailable
              ? 'Practice remains available here. Accounts, certification attempts and the public referee directory are stored on the secure hosted version.'
              : 'Rules, Play and Referee practice always work as a guest. Sign in or create an account to keep your results and begin certification.',
          )}
        </p>
        <Button
          size="sm"
          onClick={() => (unavailable ? openSecureApp(page) : signIn())}
        >
          {unavailable ? <ExternalLink /> : <LogIn />}
          {t(unavailable ? 'Open secure site' : 'Sign in or create account')}
        </Button>
      </AlertDescription>
    </Alert>
  );
}

export function LoadingCards() {
  return (
    <div
      className="grid gap-4 md:grid-cols-2 xl:grid-cols-3"
      aria-label="Loading account information"
    >
      {[0, 1, 2].map((item) => (
        <div
          key={item}
          className="h-36 animate-pulse rounded-xl border border-white/10 bg-white/5"
        />
      ))}
    </div>
  );
}
