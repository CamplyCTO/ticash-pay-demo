import { OnboardingScreen } from '@ticash/core';
import { useI18n } from '@ticash/i18n';

/** Agent onboarding: same hero, agent-facing copy, and login-only — agents are
 *  admin-provisioned (no self-registration), so only a "Sign in" CTA is shown. */
export default function AgentOnboarding() {
  const { t } = useI18n();
  return (
    <OnboardingScreen
      title={t('agent.onboardingTitle')}
      subtitle={t('agent.onboardingSubtitle')}
      allowSignUp={false}
      note={t('agent.onboardingNote')}
    />
  );
}
