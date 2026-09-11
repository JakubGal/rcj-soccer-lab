'use client';

import { LogIn, LogOut, ShieldCheck, UserRound } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import type { AcademyPage, AccountProfile } from '@/lib/account';
import { useLocalization } from '@/components/i18n/LocalizationProvider';
import { useAccount } from './AccountProvider';

function initials(value: string) {
  const parts = value.trim().split(/\s+/u).filter(Boolean);
  return (
    (parts[0]?.[0] ?? 'R') + (parts.length > 1 ? (parts.at(-1)?.[0] ?? '') : '')
  );
}

/** Kept separate so tests render the actual expanded menu, not a closed portal. */
export function AccountMenuItems({
  profile,
  onNavigate,
  onSignOut,
}: {
  profile: AccountProfile;
  onNavigate: (page: AcademyPage) => void;
  onSignOut: () => void;
}) {
  const { t } = useLocalization();
  return (
    <>
      <DropdownMenuGroup>
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
      </DropdownMenuGroup>
      <DropdownMenuSeparator />
      <DropdownMenuItem onClick={onSignOut}>
        <LogOut /> {t('Use guest mode')}
      </DropdownMenuItem>
    </>
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
        <AccountMenuItems
          profile={profile}
          onNavigate={onNavigate}
          onSignOut={signOut}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
