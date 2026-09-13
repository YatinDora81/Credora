import type { Customer } from "@prisma/client";
import { prisma } from "../client";

export class CustomerRepository {
  findByApiKey = async (apiKey: string): Promise<Customer | null> =>
    prisma.customer.findUnique({ where: { apiKey } });
}

export const customerRepository = new CustomerRepository();
