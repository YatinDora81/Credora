import { prisma } from "./index";

const CUSTOMERS = [
  {
    id: "kaveri",
    name: "Kaveri Capital",
    apiKey: "dv_live_kaveri_7f3a9c2e",
    policyCustomerKey: "kaveri_capital",
    activeVersionEnv: "KAVERI_ACTIVE_POLICY_VERSION",
    fallbackVersion: "3.1",
  },
  {
    id: "nexa",
    name: "Nexa Finserv",
    apiKey: "dv_live_nexa_4b8d1e6a",
    policyCustomerKey: "nexa_finserv",
    activeVersionEnv: "NEXA_ACTIVE_POLICY_VERSION",
    fallbackVersion: "1.4",
  },
] as const;

async function main(): Promise<void> {
  for (const c of CUSTOMERS) {
    const data = {
      name: c.name,
      apiKey: c.apiKey,
      policyCustomerKey: c.policyCustomerKey,
      activeVersionEnv: c.activeVersionEnv,
      fallbackVersion: c.fallbackVersion,
    };
    await prisma.customer.upsert({
      where: { id: c.id },
      update: data,
      create: { id: c.id, ...data },
    });
    console.log(`seed: customer ${c.id} (${c.name}) -> ${c.policyCustomerKey}@${c.fallbackVersion}`);
  }

  const upstream = await prisma.upstreamState.upsert({
    where: { id: "upstream" },
    update: {},
    create: { id: "upstream", circuit: "CLOSED", consecutiveFailures: 0 },
  });
  console.log(`seed: upstreamState ${upstream.id} circuit=${upstream.circuit}`);

  const customers = await prisma.customer.count();
  console.log(`seed: done — ${customers} customers, 1 upstream state row`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (err) => {
    console.error("seed: failed", err);
    await prisma.$disconnect();
    process.exit(1);
  });
