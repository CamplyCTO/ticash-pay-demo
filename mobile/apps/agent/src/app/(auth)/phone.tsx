import { PhoneScreen } from '@ticash/core';

/** Agents are admin-provisioned: pin to login so the phone step can never self-register. */
export default function AgentPhone() {
  return <PhoneScreen forceMode="login" />;
}
