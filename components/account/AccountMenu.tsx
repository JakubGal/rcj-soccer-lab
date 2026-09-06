'use client';

import { LogIn, LogOut, ShieldCheck, UserRound } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import type { AcademyPage } from '@/lib/account';
import { useLocalization } from '@/components/i18n/LocalizationProvider';
import { useAccount } from './AccountProvider';

function initials(value: string) {
  const parts = value.trim().split(/\s+/u).filter(Boolean);
  return (
    (parts[0]?.[0] ?? 'R') + (parts.length > 1 ? (parts.at(-1)?.[0] ?? '') : '')
  );
}

export function AccountMenu({
  onNavigate,
  compact = false,
}: {
  onNavigate: (page: AcademyPage) => void;
  compact?: boolean;
}) {
  const { t } = useLocalization();
  const { status, account, signIn, signOut } = useAccount();
  if (status === 'loading')
    return (
      <Skeleton className={compact ? 'size-8 rounded-full' : 'h-8 w-24'} />
    );

  if (status !== 'authenticated' || !account?.profile)
    return (
      <Button
        variant="outline"
        size={compact ? 'icon' : 'sm'}
        onClick={() => {
          signIn();
          onNavigate('profile');
        }}
        aria-label={t('Create local profile')}
      >
        <LogIn />
        {!compact && <span>{t('Create local profile')}</span>}
      </Button>
    );

  const profile = account.profile;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size={compact ? 'icon' : 'sm'}
            aria-label="Open account menu"
          />
        }
      >
        <Avatar size="sm">
          <AvatarFallback data-i18n-skip>
            {initials(profile.displayName).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        {!compact && <span data-i18n-skip>{profile.displayName}</span>}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        <DropdownMenuLabel>
          <small className="block font-normal text-slate-400">
            {t('Local profile')}
          </small>
          <span className="block" data-i18n-skip>
            {profile.displayName}
          </span>
          {profile.refereeNumber && (
            <small className="font-mono font-normal" data-i18n-skip>
              {profile.refereeNumber}
            </small>
          )}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => onNavigate('profile')}>
          <UserRound /> {t('Profile and progress')}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onNavigate('certification')}>
          <ShieldCheck /> {t('Certification')}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={signOut}>
          <LogOut /> {t('Use guest mode')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
