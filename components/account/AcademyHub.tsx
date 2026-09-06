'use client';

import { BadgeCheck, ShieldCheck, UserRound, UsersRound } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useLocalization } from '@/components/i18n/LocalizationProvider';
import type { AcademyPage, CertificationGameLaunch } from '@/lib/account';
import { useAccount } from './AccountProvider';
import { CertificationPanel } from './CertificationPanel';
import { CertifiedRefereesPanel } from './CertifiedRefereesPanel';
import { ProfilePanel } from './ProfilePanel';

export function AcademyHub({
  page = 'profile',
  onPageChange,
  onOpenRules,
  onLaunchGame,
}: {
  page?: AcademyPage;
  onPageChange?: (page: AcademyPage) => void;
  onOpenRules?: (roundId: string) => void;
  onLaunchGame?: (launch: CertificationGameLaunch) => void;
}) {
  const { t } = useLocalization();
  const { status, account } = useAccount();
  const effectivePage: AcademyPage =
    status !== 'authenticated' && page === 'profile' ? 'profile' : page;
  const roundStatus = account?.certification?.status;

  return (
    <section
      className="min-h-0 flex-1 overflow-y-auto bg-[#0b1118] text-slate-100"
      aria-label="Training and certification academy"
    >
      <div className="mx-auto grid w-full max-w-[1320px] gap-5 px-3 py-5 sm:px-5 lg:px-7">
        <header className="flex flex-col gap-4 rounded-xl border border-sky-400/20 bg-gradient-to-r from-[#122b3c] to-[#0e1923] p-4 sm:flex-row sm:items-end sm:justify-between sm:p-5">
          <div>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Badge
                variant="outline"
                className="border-sky-400/30 text-sky-200"
              >
                <ShieldCheck /> {t('RCJ Soccer 2026')}
              </Badge>
              {roundStatus === 'qualified' && (
                <Badge className="bg-emerald-500/15 text-emerald-300">
                  <BadgeCheck /> {t('Certified')}
                </Badge>
              )}
            </div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {t('Training and certification')}
            </h1>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-300">
              {t(
                'Practice freely as a guest, or sign in to save progress, complete referee certification and appear in the public directory.',
              )}
            </p>
          </div>
          {status === 'authenticated' && account?.profile && (
            <div className="text-sm sm:text-right">
              <span className="block text-slate-400">{t('Signed in as')}</span>
              <strong data-i18n-skip>{account.profile.displayName}</strong>
              {account.profile.refereeNumber && (
                <span
                  className="ml-2 font-mono text-xs text-sky-300"
                  data-i18n-skip
                >
                  {account.profile.refereeNumber}
                </span>
              )}
            </div>
          )}
        </header>

        <Tabs
          value={effectivePage}
          onValueChange={(value) => onPageChange?.(value as AcademyPage)}
        >
          <div className="overflow-x-auto pb-1">
            <TabsList className="min-w-max" aria-label="Academy sections">
              <TabsTrigger value="profile">
                <UserRound /> {t('Profile')}
              </TabsTrigger>
              <TabsTrigger value="certification">
                <ShieldCheck /> {t('Certification')}
              </TabsTrigger>
              <TabsTrigger value="referees">
                <UsersRound /> {t('Certified referees')}
              </TabsTrigger>
            </TabsList>
          </div>
          <TabsContent value="profile">
            <ProfilePanel />
          </TabsContent>
          <TabsContent value="certification">
            <CertificationPanel
              onOpenRules={onOpenRules}
              onLaunchGame={onLaunchGame}
            />
          </TabsContent>
          <TabsContent value="referees">
            <CertifiedRefereesPanel />
          </TabsContent>
        </Tabs>
      </div>
    </section>
  );
}
