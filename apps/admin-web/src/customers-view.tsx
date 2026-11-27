import { CustomerRecord } from "./customer-record.js";
import { CustomersList } from "./customers-list.js";

/** `#/clientes` (list) and `#/clientes/:id` (record). */
export function CustomersView({
  customerId,
  onAuthenticationRequired,
}: {
  readonly customerId: string | null;
  readonly onAuthenticationRequired: () => void;
}) {
  return customerId === null ? (
    <CustomersList onAuthenticationRequired={onAuthenticationRequired} />
  ) : (
    <CustomerRecord
      key={customerId}
      customerId={customerId}
      onAuthenticationRequired={onAuthenticationRequired}
    />
  );
}
