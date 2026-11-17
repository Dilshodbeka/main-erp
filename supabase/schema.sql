BEGIN;

-- Fail on name collisions rather than alter an existing installation.
CREATE TABLE public.erp_companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 160),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp()
);
CREATE TABLE public.erp_metadata (
  company_id uuid PRIMARY KEY REFERENCES public.erp_companies(id),
  revision bigint NOT NULL DEFAULT 0 CHECK (revision BETWEEN 0 AND 9007199254740991),
  currency text NOT NULL DEFAULT 'UZS' CHECK (currency = 'UZS')
);

CREATE TABLE public.erp_customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.erp_companies(id),
  name text NOT NULL CHECK (btrim(name) <> ''),
  phone text NOT NULL DEFAULT '',
  address text NOT NULL DEFAULT '',
  kind text NOT NULL DEFAULT 'customer' CHECK (kind IN ('customer', 'shop', 'service')),
  UNIQUE (company_id, id)
);
CREATE TABLE public.erp_suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.erp_companies(id),
  name text NOT NULL CHECK (btrim(name) <> ''),
  phone text NOT NULL DEFAULT '',
  UNIQUE (company_id, id)
);
CREATE TABLE public.erp_employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.erp_companies(id),
  name text NOT NULL CHECK (btrim(name) <> ''),
  active boolean NOT NULL DEFAULT true,
  deactivated_at date,
  UNIQUE (company_id, id)
);
CREATE TABLE public.erp_profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.erp_companies(id),
  name text NOT NULL CHECK (btrim(name) <> ''),
  role text NOT NULL CHECK (role IN ('admin', 'worker', 'display')),
  employee_id uuid,
  permissions jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(permissions) = 'array'),
  scope_workshop_ids jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(scope_workshop_ids) = 'array'),
  scope_warehouse_ids jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(scope_warehouse_ids) = 'array'),
  UNIQUE (company_id, employee_id),
  FOREIGN KEY (company_id, employee_id) REFERENCES public.erp_employees(company_id, id),
  CHECK ((role IN ('admin', 'display') AND employee_id IS NULL) OR (role = 'worker' AND employee_id IS NOT NULL))
);
CREATE TABLE public.erp_machines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.erp_companies(id),
  name text NOT NULL CHECK (btrim(name) <> ''),
  hourly_revenue_target numeric NOT NULL CHECK (hourly_revenue_target BETWEEN 0 AND 1000000000000 AND hourly_revenue_target = round(hourly_revenue_target, 2)),
  active boolean NOT NULL DEFAULT true,
  UNIQUE (company_id, id)
);
CREATE TABLE public.erp_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.erp_companies(id),
  name text NOT NULL CHECK (btrim(name) <> ''),
  unit text NOT NULL CHECK (unit IN ('sheet', 'meter', 'squareMeter', 'piece', 'hole', 'minute', 'hour')),
  sale_price numeric NOT NULL CHECK (sale_price BETWEEN 0 AND 1000000000000 AND sale_price = round(sale_price, 2)),
  worker_rate numeric NOT NULL CHECK (worker_rate BETWEEN 0 AND 1000000000000 AND worker_rate = round(worker_rate, 2)),
  standard_minutes numeric NOT NULL CHECK (standard_minutes BETWEEN 0 AND 1000000000),
  machine_id uuid,
  employee_ids uuid[] NOT NULL DEFAULT '{}',
  active boolean NOT NULL DEFAULT true,
  auto_accept boolean NOT NULL DEFAULT true,
  norms jsonb NOT NULL DEFAULT '[]'::jsonb,
  UNIQUE (company_id, id),
  FOREIGN KEY (company_id, machine_id) REFERENCES public.erp_machines(company_id, id)
);
CREATE TABLE public.erp_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.erp_companies(id),
  name text NOT NULL CHECK (btrim(name) <> ''),
  unit text NOT NULL CHECK (btrim(unit) <> ''),
  min_qty numeric NOT NULL CHECK (min_qty BETWEEN 0 AND 1000000000),
  cost numeric NOT NULL CHECK (cost BETWEEN 0 AND 1000000000000 AND cost = round(cost, 2)),
  customer_id uuid,
  kind text NOT NULL DEFAULT 'material' CHECK (kind IN ('material', 'blank', 'finished')),
  sale_price numeric NOT NULL DEFAULT 0 CHECK (sale_price BETWEEN 0 AND 1000000000000 AND sale_price = round(sale_price, 2)),
  last_purchase_price numeric NOT NULL DEFAULT 0 CHECK (last_purchase_price BETWEEN 0 AND 1000000000000 AND last_purchase_price = round(last_purchase_price, 2)),
  material_cost numeric NOT NULL DEFAULT 0 CHECK (material_cost BETWEEN 0 AND 1000000000000 AND material_cost = round(material_cost, 2)),
  labor_cost numeric NOT NULL DEFAULT 0 CHECK (labor_cost BETWEEN 0 AND 1000000000000 AND labor_cost = round(labor_cost, 2)),
  category text CHECK (category IS NULL OR category ~ '^[0-9]{2}\.[0-9]{2}$'),
  photo text NOT NULL DEFAULT '' CHECK (length(photo) <= 200000),
  UNIQUE (company_id, id),
  FOREIGN KEY (company_id, customer_id) REFERENCES public.erp_customers(company_id, id),
  CHECK (customer_id IS NULL OR cost = 0)
);
CREATE TABLE public.erp_recipes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.erp_companies(id),
  output_item_id uuid NOT NULL,
  name text NOT NULL CHECK (btrim(name) <> ''),
  active boolean NOT NULL DEFAULT true,
  UNIQUE (company_id, id),
  FOREIGN KEY (company_id, output_item_id) REFERENCES public.erp_items(company_id, id)
);
CREATE TABLE public.erp_recipe_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.erp_companies(id),
  recipe_id uuid NOT NULL,
  version integer NOT NULL CHECK (version > 0 AND version <= 1000000),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  UNIQUE (company_id, id),
  UNIQUE (company_id, recipe_id, version),
  FOREIGN KEY (company_id, recipe_id) REFERENCES public.erp_recipes(company_id, id)
);
CREATE TABLE public.erp_recipe_components (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.erp_companies(id),
  version_id uuid NOT NULL,
  position integer NOT NULL CHECK (position >= 0),
  slot text NOT NULL CHECK (btrim(slot) <> '' AND length(slot) <= 120),
  item_id uuid,
  allowed_item_ids uuid[] NOT NULL DEFAULT '{}',
  qty_per_unit numeric NOT NULL CHECK (qty_per_unit > 0 AND qty_per_unit <= 1000000000),
  UNIQUE (company_id, version_id, slot),
  UNIQUE (company_id, version_id, position),
  FOREIGN KEY (company_id, version_id) REFERENCES public.erp_recipe_versions(company_id, id),
  FOREIGN KEY (company_id, item_id) REFERENCES public.erp_items(company_id, id),
  CHECK (item_id IS NOT NULL OR cardinality(allowed_item_ids) > 0)
);
CREATE TABLE public.erp_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.erp_companies(id),
  number text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('product', 'service', 'series', 'composite')),
  customer_id uuid,
  title text NOT NULL CHECK (btrim(title) <> ''),
  qty numeric NOT NULL CHECK (qty > 0 AND qty <= 1000000000),
  price numeric NOT NULL CHECK (price BETWEEN 0 AND 1000000000000 AND price = round(price, 2)),
  overhead numeric NOT NULL CHECK (overhead BETWEEN 0 AND 1000000000000 AND overhead = round(overhead, 2)),
  markup numeric NOT NULL DEFAULT 0 CHECK (markup BETWEEN -1000000000000 AND 1000000000000 AND markup = round(markup, 2)),
  due_date text NOT NULL DEFAULT '',
  output_item_id uuid,
  recipe_version_id uuid,
  substitutions jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(substitutions) = 'object'),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'production', 'ready', 'shipped', 'delivered', 'cancelled')),
  UNIQUE (company_id, number),
  UNIQUE (company_id, id),
  FOREIGN KEY (company_id, customer_id) REFERENCES public.erp_customers(company_id, id),
  FOREIGN KEY (company_id, output_item_id) REFERENCES public.erp_items(company_id, id),
  FOREIGN KEY (company_id, recipe_version_id) REFERENCES public.erp_recipe_versions(company_id, id),
  CHECK ((kind = 'series' AND customer_id IS NULL AND output_item_id IS NOT NULL AND recipe_version_id IS NOT NULL AND price = 0 AND overhead = 0 AND markup = 0)
    OR (kind <> 'series' AND customer_id IS NOT NULL AND output_item_id IS NULL AND recipe_version_id IS NULL AND substitutions = '{}'::jsonb))
);
CREATE TABLE public.erp_order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.erp_companies(id),
  order_id uuid NOT NULL,
  position integer NOT NULL CHECK (position >= 0),
  kind text NOT NULL CHECK (kind IN ('product', 'service')),
  title text NOT NULL CHECK (btrim(title) <> ''),
  qty numeric NOT NULL CHECK (qty > 0 AND qty <= 1000000000),
  total numeric NOT NULL CHECK (total BETWEEN 0 AND 1000000000000 AND total = round(total, 2)),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'production', 'ready', 'shipped', 'delivered', 'cancelled')),
  UNIQUE (company_id, id),
  UNIQUE (company_id, order_id, position),
  FOREIGN KEY (company_id, order_id) REFERENCES public.erp_orders(company_id, id)
);
CREATE TABLE public.erp_order_materials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.erp_companies(id),
  order_id uuid NOT NULL,
  line_id uuid NOT NULL,
  item_id uuid NOT NULL,
  position integer NOT NULL CHECK (position >= 0),
  qty numeric NOT NULL CHECK (qty > 0 AND qty <= 1000000000),
  issued_qty numeric NOT NULL DEFAULT 0,
  estimated_cost numeric NOT NULL CHECK (estimated_cost BETWEEN 0 AND 1000000000000 AND estimated_cost = round(estimated_cost, 2)),
  actual_cost numeric NOT NULL DEFAULT 0 CHECK (actual_cost BETWEEN 0 AND 1000000000000 AND actual_cost = round(actual_cost, 2)),
  UNIQUE (company_id, line_id, item_id),
  UNIQUE (company_id, order_id, position),
  FOREIGN KEY (company_id, order_id) REFERENCES public.erp_orders(company_id, id),
  FOREIGN KEY (company_id, line_id) REFERENCES public.erp_order_items(company_id, id),
  FOREIGN KEY (company_id, item_id) REFERENCES public.erp_items(company_id, id),
  CONSTRAINT erp_order_materials_issued_qty_check CHECK (issued_qty >= 0 AND issued_qty <= qty AND issued_qty = round(issued_qty, 3)),
  CONSTRAINT erp_order_materials_issued_actual_check CHECK (issued_qty > 0 OR actual_cost = 0),
  CHECK (round(qty * estimated_cost, 2) <= 1000000000000),
  CHECK (round(qty * actual_cost, 2) <= 1000000000000)
);
CREATE TABLE public.erp_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.erp_companies(id),
  order_id uuid NOT NULL,
  line_id uuid NOT NULL,
  position integer NOT NULL CHECK (position >= 0),
  operation_id uuid NOT NULL,
  name text NOT NULL CHECK (btrim(name) <> ''),
  employee_id uuid,
  supplier_id uuid,
  executor_kind text NOT NULL DEFAULT 'employee',
  rate numeric NOT NULL CHECK (rate BETWEEN 0 AND 1000000000000 AND rate = round(rate, 2)),
  supplier_cost numeric NOT NULL DEFAULT 0 CHECK (supplier_cost BETWEEN 0 AND 1000000000000 AND supplier_cost = round(supplier_cost, 2)),
  sale_price numeric NOT NULL DEFAULT 0 CHECK (sale_price BETWEEN 0 AND 1000000000000 AND sale_price = round(sale_price, 2)),
  standard_minutes numeric NOT NULL DEFAULT 0 CHECK (standard_minutes BETWEEN 0 AND 1000000000),
  planned numeric NOT NULL CHECK (planned > 0 AND planned <= 1000000000),
  completed numeric NOT NULL DEFAULT 0 CHECK (completed >= 0 AND completed <= planned),
  status text NOT NULL DEFAULT 'assigned' CHECK (status IN ('assigned', 'accepted', 'in_progress', 'submitted', 'completed')),
  UNIQUE (company_id, id),
  UNIQUE (company_id, id, order_id),
  UNIQUE (company_id, id, order_id, employee_id),
  UNIQUE (company_id, order_id, position),
  FOREIGN KEY (company_id, order_id) REFERENCES public.erp_orders(company_id, id),
  FOREIGN KEY (company_id, line_id) REFERENCES public.erp_order_items(company_id, id),
  FOREIGN KEY (company_id, operation_id) REFERENCES public.erp_operations(company_id, id),
  FOREIGN KEY (company_id, employee_id) REFERENCES public.erp_employees(company_id, id),
  FOREIGN KEY (company_id, supplier_id) REFERENCES public.erp_suppliers(company_id, id),
  CHECK (executor_kind IN ('employee', 'supplier')),
  CHECK ((executor_kind = 'employee' AND employee_id IS NOT NULL AND supplier_id IS NULL)
    OR (executor_kind = 'supplier' AND employee_id IS NULL AND supplier_id IS NOT NULL)),
  CHECK (round(planned * rate, 2) <= 1000000000000)
);
CREATE TABLE public.erp_purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.erp_companies(id),
  number text NOT NULL,
  supplier_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  UNIQUE (company_id, number),
  UNIQUE (company_id, id),
  FOREIGN KEY (company_id, supplier_id) REFERENCES public.erp_suppliers(company_id, id)
);
CREATE TABLE public.erp_purchase_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.erp_companies(id),
  purchase_id uuid NOT NULL,
  item_id uuid NOT NULL,
  position integer NOT NULL CHECK (position >= 0),
  qty numeric NOT NULL CHECK (qty > 0 AND qty <= 1000000000),
  price numeric NOT NULL CHECK (price BETWEEN 0 AND 1000000000000 AND price = round(price, 2)),
  received numeric NOT NULL DEFAULT 0 CHECK (received >= 0 AND received <= qty),
  previous_purchase_price numeric NOT NULL DEFAULT 0 CHECK (previous_purchase_price BETWEEN 0 AND 1000000000000 AND previous_purchase_price = round(previous_purchase_price, 2)),
  new_purchase_price numeric NOT NULL DEFAULT 0 CHECK (new_purchase_price BETWEEN 0 AND 1000000000000 AND new_purchase_price = round(new_purchase_price, 2)),
  previous_average_cost numeric NOT NULL DEFAULT 0 CHECK (previous_average_cost BETWEEN 0 AND 1000000000000 AND previous_average_cost = round(previous_average_cost, 2)),
  new_average_cost numeric NOT NULL DEFAULT 0 CHECK (new_average_cost BETWEEN 0 AND 1000000000000 AND new_average_cost = round(new_average_cost, 2)),
  UNIQUE (company_id, purchase_id, item_id),
  UNIQUE (company_id, purchase_id, position),
  FOREIGN KEY (company_id, purchase_id) REFERENCES public.erp_purchases(company_id, id),
  FOREIGN KEY (company_id, item_id) REFERENCES public.erp_items(company_id, id),
  CHECK (round(qty * price, 2) <= 1000000000000)
);
CREATE TABLE public.erp_stock_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.erp_companies(id),
  item_id uuid NOT NULL,
  direction text NOT NULL CHECK (direction IN ('in', 'out')),
  qty numeric NOT NULL CHECK (qty > 0 AND qty <= 1000000000),
  unit_cost numeric NOT NULL CHECK (unit_cost BETWEEN 0 AND 1000000000000 AND unit_cost = round(unit_cost, 2)),
  source text NOT NULL CHECK (source IN ('purchase', 'order', 'inventory', 'customer', 'production', 'sale')),
  source_id uuid NOT NULL,
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  FOREIGN KEY (company_id, item_id) REFERENCES public.erp_items(company_id, id),
  CHECK (round(qty * unit_cost, 2) <= 1000000000000)
);
CREATE TABLE public.erp_cash (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.erp_companies(id),
  direction text NOT NULL CHECK (direction IN ('in', 'out', 'transfer')),
  amount numeric NOT NULL CHECK (amount > 0 AND amount <= 1000000000000 AND amount = round(amount, 2)),
  account text NOT NULL CHECK (account IN ('cash', 'bank')),
  to_account text CHECK (to_account IN ('cash', 'bank')),
  source text NOT NULL CHECK (source IN ('manual', 'sale', 'supplier', 'payroll', 'expense', 'loan', 'transfer')),
  source_id uuid,
  customer_id uuid,
  category text NOT NULL,
  note text NOT NULL DEFAULT '',
  number text,
  reversal_of uuid,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  UNIQUE (company_id, id),
  UNIQUE (company_id, reversal_of),
  FOREIGN KEY (company_id, reversal_of) REFERENCES public.erp_cash(company_id, id),
  FOREIGN KEY (company_id, customer_id) REFERENCES public.erp_customers(company_id, id),
  CHECK ((direction = 'transfer' AND to_account IS NOT NULL AND to_account <> account AND source = 'transfer')
    OR (direction IN ('in', 'out') AND to_account IS NULL AND source <> 'transfer')),
  CHECK ((source IN ('manual', 'transfer') AND source_id IS NULL AND customer_id IS NULL)
    OR (source = 'sale' AND source_id IS NOT NULL AND customer_id = source_id)
    OR (source IN ('supplier', 'payroll', 'expense', 'loan') AND source_id IS NOT NULL AND customer_id IS NULL)),
  CHECK (reversal_of IS NULL OR reversal_of <> id)
);
CREATE TABLE public.erp_work_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.erp_companies(id),
  order_id uuid NOT NULL,
  task_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  qty numeric NOT NULL CHECK (qty > 0 AND qty <= 1000000000),
  status text NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'accepted', 'rejected')),
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  UNIQUE (company_id, id),
  UNIQUE (company_id, id, order_id, employee_id),
  FOREIGN KEY (company_id, task_id, order_id) REFERENCES public.erp_tasks(company_id, id, order_id),
  FOREIGN KEY (company_id, employee_id) REFERENCES public.erp_employees(company_id, id)
);
CREATE TABLE public.erp_payroll (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.erp_companies(id),
  employee_id uuid NOT NULL,
  report_id uuid NOT NULL,
  order_id uuid NOT NULL,
  task_id uuid NOT NULL,
  amount numeric NOT NULL CHECK (amount BETWEEN 0 AND 1000000000000 AND amount = round(amount, 2)),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  UNIQUE (company_id, report_id),
  UNIQUE (company_id, order_id, task_id, employee_id),
  FOREIGN KEY (company_id, report_id, order_id, employee_id) REFERENCES public.erp_work_reports(company_id, id, order_id, employee_id),
  FOREIGN KEY (company_id, task_id, order_id) REFERENCES public.erp_tasks(company_id, id, order_id),
  FOREIGN KEY (company_id, employee_id) REFERENCES public.erp_employees(company_id, id)
);
CREATE TABLE public.erp_defects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.erp_companies(id),
  report_id uuid NOT NULL,
  order_id uuid NOT NULL,
  line_id uuid NOT NULL,
  task_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  operation_id uuid NOT NULL,
  qty numeric NOT NULL CHECK (qty > 0 AND qty <= 1000000000 AND qty = round(qty, 2)),
  reason text NOT NULL CHECK (reason IN ('quality', 'measurement', 'drawing', 'customer', 'other')),
  note text NOT NULL DEFAULT '' CHECK (length(note) <= 500 AND (reason <> 'other' OR btrim(note) <> '')),
  materials jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(materials) = 'array'),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  UNIQUE (company_id, id),
  FOREIGN KEY (company_id, report_id) REFERENCES public.erp_work_reports(company_id, id),
  FOREIGN KEY (company_id, task_id, order_id) REFERENCES public.erp_tasks(company_id, id, order_id),
  FOREIGN KEY (company_id, line_id) REFERENCES public.erp_order_items(company_id, id),
  FOREIGN KEY (company_id, employee_id) REFERENCES public.erp_employees(company_id, id),
  FOREIGN KEY (company_id, operation_id) REFERENCES public.erp_operations(company_id, id)
);
CREATE TABLE public.erp_salary_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.erp_companies(id),
  employee_id uuid NOT NULL,
  amount numeric NOT NULL CHECK (amount BETWEEN 0 AND 1000000000000 AND amount = round(amount, 2)),
  mode text NOT NULL DEFAULT 'fixed' CHECK (mode = 'fixed'),
  from_month text NOT NULL CHECK (from_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  UNIQUE (company_id, id),
  UNIQUE (company_id, employee_id, from_month),
  FOREIGN KEY (company_id, employee_id) REFERENCES public.erp_employees(company_id, id)
);
CREATE TABLE public.erp_expense_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL,
  company_id uuid NOT NULL REFERENCES public.erp_companies(id),
  title text NOT NULL,
  amount numeric NOT NULL CHECK (amount BETWEEN 0 AND 1000000000000 AND amount = round(amount, 2)),
  from_month text NOT NULL CHECK (from_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  due_day integer NOT NULL DEFAULT 15 CHECK (due_day BETWEEN 1 AND 31),
  supplier_id uuid,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  UNIQUE (company_id, id),
  UNIQUE (company_id, plan_id, from_month),
  FOREIGN KEY (company_id, supplier_id) REFERENCES public.erp_suppliers(company_id, id)
);
CREATE TABLE public.erp_loans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.erp_companies(id),
  title text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('loan', 'investment')),
  amount numeric NOT NULL CHECK (amount BETWEEN 0 AND 1000000000000 AND amount = round(amount, 2)),
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  UNIQUE (company_id, id)
);
CREATE INDEX erp_loans_company_idx ON public.erp_loans(company_id);
CREATE TABLE public.erp_route_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.erp_companies(id),
  name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('product', 'service')),
  active boolean NOT NULL DEFAULT true,
  stages jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  UNIQUE (company_id, id)
);
CREATE INDEX erp_route_templates_company_idx ON public.erp_route_templates(company_id);
CREATE UNIQUE INDEX erp_route_templates_name_idx ON public.erp_route_templates(company_id, lower(btrim(name)));
CREATE TABLE public.erp_support_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.erp_companies(id),
  author_id uuid NOT NULL,
  author_name text NOT NULL,
  author_role text NOT NULL CHECK (author_role IN ('admin', 'worker')),
  status text NOT NULL CHECK (status IN ('open', 'closed')),
  messages jsonb NOT NULL CHECK (jsonb_typeof(messages) = 'array' AND jsonb_array_length(messages) BETWEEN 1 AND 200),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  closed_at timestamptz,
  closed_by_name text,
  UNIQUE (company_id, id),
  CHECK ((status = 'open') = (closed_at IS NULL)),
  CHECK ((status = 'closed') = (closed_by_name IS NOT NULL))
);
CREATE INDEX erp_support_tickets_company_idx ON public.erp_support_tickets(company_id);
CREATE INDEX erp_support_tickets_author_idx ON public.erp_support_tickets(company_id, author_id);
CREATE TABLE public.erp_worker_deductions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.erp_companies(id),
  employee_id uuid NOT NULL,
  customer_id uuid NOT NULL,
  amount numeric(14, 2) NOT NULL,
  direction text NOT NULL CHECK (direction IN ('deduct', 'refund')),
  note text NOT NULL DEFAULT '',
  reversal_of uuid,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (company_id, id),
  FOREIGN KEY (company_id, employee_id) REFERENCES public.erp_employees(company_id, id),
  FOREIGN KEY (company_id, customer_id) REFERENCES public.erp_customers(company_id, id)
);
ALTER TABLE public.erp_customers ADD COLUMN IF NOT EXISTS employee_id uuid
  REFERENCES public.erp_employees(id);
CREATE UNIQUE INDEX IF NOT EXISTS erp_customers_employee_idx
  ON public.erp_customers(company_id, employee_id) WHERE employee_id IS NOT NULL;
ALTER TABLE public.erp_customers ADD COLUMN IF NOT EXISTS seller_id uuid;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'erp_customers_seller_fk') THEN
    ALTER TABLE public.erp_customers ADD CONSTRAINT erp_customers_seller_fk
      FOREIGN KEY (company_id, seller_id) REFERENCES public.erp_employees(company_id, id);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS erp_customers_seller_idx ON public.erp_customers(company_id, seller_id);
CREATE INDEX erp_worker_deductions_company_idx
  ON public.erp_worker_deductions(company_id, employee_id, created_at);
CREATE TABLE public.erp_shipments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.erp_companies(id),
  order_id uuid,
  customer_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('order', 'stock')),
  address text NOT NULL DEFAULT '',
  due_date text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'shipped' CHECK (status IN ('shipped', 'delivered', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  delivered_at timestamptz,
  UNIQUE (company_id, id),
  FOREIGN KEY (company_id, order_id) REFERENCES public.erp_orders(company_id, id),
  FOREIGN KEY (company_id, customer_id) REFERENCES public.erp_customers(company_id, id),
  CHECK ((kind = 'order' AND order_id IS NOT NULL) OR (kind = 'stock' AND order_id IS NULL)),
  CHECK ((status = 'shipped' AND delivered_at IS NULL) OR (status = 'delivered' AND delivered_at IS NOT NULL) OR status = 'cancelled')
);
CREATE TABLE public.erp_shipment_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.erp_companies(id),
  shipment_id uuid NOT NULL,
  line_id uuid,
  position integer NOT NULL CHECK (position >= 0),
  item_id uuid,
  description text NOT NULL CHECK (btrim(description) <> ''),
  qty numeric NOT NULL CHECK (qty > 0 AND qty <= 1000000000),
  sale_price numeric NOT NULL CHECK (sale_price BETWEEN 0 AND 1000000000000),
  unit_cost numeric NOT NULL CHECK (unit_cost BETWEEN 0 AND 1000000000000),
  material_cost numeric NOT NULL CHECK (material_cost BETWEEN 0 AND 1000000000000),
  labor_cost numeric NOT NULL CHECK (labor_cost BETWEEN 0 AND 1000000000000),
  UNIQUE (company_id, id),
  UNIQUE (company_id, shipment_id, position),
  FOREIGN KEY (company_id, shipment_id) REFERENCES public.erp_shipments(company_id, id),
  FOREIGN KEY (company_id, item_id) REFERENCES public.erp_items(company_id, id),
  FOREIGN KEY (company_id, line_id) REFERENCES public.erp_order_items(company_id, id),
  CHECK ((item_id IS NULL) = (line_id IS NOT NULL))
);
CREATE TABLE public.erp_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.erp_companies(id),
  request_id uuid NOT NULL,
  actor_user_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  actor_name text NOT NULL,
  action text NOT NULL,
  entity_id text NOT NULL,
  command jsonb NOT NULL,
  expected_revision bigint,
  revision bigint NOT NULL CHECK (revision BETWEEN 1 AND 9007199254740991),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  UNIQUE (company_id, request_id)
);
CREATE UNIQUE INDEX erp_customers_name_idx ON public.erp_customers(company_id, lower(btrim(name)));
CREATE UNIQUE INDEX erp_suppliers_name_idx ON public.erp_suppliers(company_id, lower(btrim(name)));
CREATE UNIQUE INDEX erp_employees_name_idx ON public.erp_employees(company_id, lower(btrim(name)));
CREATE UNIQUE INDEX erp_machines_name_idx ON public.erp_machines(company_id, lower(btrim(name)));
CREATE UNIQUE INDEX erp_operations_name_idx ON public.erp_operations(company_id, lower(btrim(name)));
CREATE UNIQUE INDEX erp_items_name_scope_idx ON public.erp_items(
  company_id, lower(btrim(name)), coalesce(customer_id::text, '')
);
CREATE UNIQUE INDEX erp_recipes_name_idx ON public.erp_recipes(company_id, lower(btrim(name)));
CREATE INDEX erp_orders_output_idx ON public.erp_orders(company_id, output_item_id);
CREATE INDEX erp_recipe_versions_recipe_idx ON public.erp_recipe_versions(company_id, recipe_id);
CREATE INDEX erp_recipe_components_version_idx ON public.erp_recipe_components(company_id, version_id);
CREATE INDEX erp_tasks_employee_idx ON public.erp_tasks(company_id, employee_id, order_id);
CREATE INDEX erp_orders_customer_idx ON public.erp_orders(company_id, customer_id);
CREATE INDEX erp_items_customer_idx ON public.erp_items(company_id, customer_id);
CREATE INDEX erp_stock_item_idx ON public.erp_stock_movements(company_id, item_id);
CREATE INDEX erp_cash_source_idx ON public.erp_cash(company_id, source, source_id);
CREATE INDEX erp_cash_customer_date_idx ON public.erp_cash(company_id, customer_id, created_at, id);
CREATE INDEX erp_reports_employee_idx ON public.erp_work_reports(company_id, employee_id, created_at);
CREATE INDEX erp_reports_task_idx ON public.erp_work_reports(company_id, task_id, status);
CREATE INDEX erp_defects_order_idx ON public.erp_defects(company_id, order_id);
CREATE INDEX erp_defects_employee_idx ON public.erp_defects(company_id, employee_id, created_at);
CREATE INDEX erp_payroll_employee_idx ON public.erp_payroll(company_id, employee_id);
CREATE INDEX erp_salary_plans_employee_idx ON public.erp_salary_plans(company_id, employee_id, from_month);
CREATE INDEX erp_expense_plans_plan_idx ON public.erp_expense_plans(company_id, plan_id, from_month);
CREATE INDEX erp_shipments_order_idx ON public.erp_shipments(company_id, order_id);
CREATE INDEX erp_shipments_customer_idx ON public.erp_shipments(company_id, customer_id, created_at, id);
CREATE INDEX erp_shipment_lines_shipment_idx ON public.erp_shipment_lines(company_id, shipment_id);
CREATE INDEX erp_shipment_lines_item_idx ON public.erp_shipment_lines(company_id, item_id);
CREATE INDEX erp_purchases_supplier_idx ON public.erp_purchases(company_id, supplier_id);
CREATE FUNCTION public.erp_num(p_value jsonb, p_label text, p_allow_zero boolean DEFAULT false)
RETURNS numeric LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp AS $$
DECLARE v numeric;
BEGIN
  IF p_value IS NULL OR jsonb_typeof(p_value) <> 'number' THEN
    RAISE EXCEPTION '% must be a finite number', p_label USING ERRCODE = '22023';
  END IF;
  v := (p_value #>> '{}')::numeric;
  IF NOT (v <= 1000000000 AND (v > 0 OR (p_allow_zero AND v = 0))) THEN
    RAISE EXCEPTION '% must be % and at most 1e9', p_label, CASE WHEN p_allow_zero THEN 'nonnegative' ELSE 'positive' END USING ERRCODE = '22023';
  END IF;
  RETURN v;
END;
$$;
CREATE FUNCTION public.erp_money(p_value jsonb, p_label text, p_allow_zero boolean DEFAULT false)
RETURNS numeric LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp AS $$
DECLARE v numeric;
BEGIN
  IF p_value IS NULL OR jsonb_typeof(p_value) <> 'number' THEN
    RAISE EXCEPTION '% must be a finite monetary number', p_label USING ERRCODE = '22023';
  END IF;
  v := (p_value #>> '{}')::numeric;
  IF NOT (v BETWEEN 0 AND 1000000000000) THEN
    RAISE EXCEPTION '% must be nonnegative and at most 1e12 UZS', p_label USING ERRCODE = '22023';
  END IF;
  v := round(v, 2);
  IF NOT p_allow_zero AND v = 0 THEN
    RAISE EXCEPTION '% must be positive after rounding to 2 decimals', p_label USING ERRCODE = '22023';
  END IF;
  RETURN v;
END;
$$;
CREATE FUNCTION public.erp_signed_money(p_value jsonb, p_label text)
RETURNS numeric LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp AS $$
DECLARE v numeric;
BEGIN
  IF p_value IS NULL OR jsonb_typeof(p_value) <> 'number' THEN
    RAISE EXCEPTION '% must be a finite monetary number', p_label USING ERRCODE = '22023';
  END IF;
  v := (p_value #>> '{}')::numeric;
  IF NOT (v BETWEEN -1000000000000 AND 1000000000000) THEN
    RAISE EXCEPTION '% must be at most 1e12 UZS in absolute value', p_label USING ERRCODE = '22023';
  END IF;
  RETURN round(v, 2);
END;
$$;
CREATE FUNCTION public.erp_uuid(p_value jsonb, p_label text)
RETURNS uuid LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp AS $$
BEGIN
  IF p_value IS NULL OR jsonb_typeof(p_value) <> 'string' THEN
    RAISE EXCEPTION '% must be a UUID', p_label USING ERRCODE = '22023';
  END IF;
  RETURN (p_value #>> '{}')::uuid;
EXCEPTION WHEN invalid_text_representation THEN
  RAISE EXCEPTION '% must be a UUID', p_label USING ERRCODE = '22023';
END;
$$;
CREATE FUNCTION public.erp_text(p_value jsonb, p_label text, p_allow_empty boolean DEFAULT false)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp AS $$
DECLARE v text;
BEGIN
  IF p_value IS NULL OR jsonb_typeof(p_value) <> 'string' THEN
    RAISE EXCEPTION '% must be a string', p_label USING ERRCODE = '22023';
  END IF;
  v := p_value #>> '{}';
  IF NOT p_allow_empty AND btrim(v) = '' THEN
    RAISE EXCEPTION '% must not be empty', p_label USING ERRCODE = '22023';
  END IF;
  RETURN v;
END;
$$;
CREATE FUNCTION public.erp_bool(p_value jsonb, p_label text)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp AS $$
BEGIN
  IF p_value IS NULL OR jsonb_typeof(p_value) <> 'boolean' THEN
    RAISE EXCEPTION '% must be a boolean', p_label USING ERRCODE = '22023';
  END IF;
  RETURN (p_value #>> '{}')::boolean;
END;
$$;
CREATE FUNCTION public.erp_account(p_value jsonb)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp AS $$
DECLARE v text := public.erp_text(p_value, 'account');
BEGIN
  IF v NOT IN ('cash', 'bank') THEN RAISE EXCEPTION 'Invalid account' USING ERRCODE = '22023'; END IF;
  RETURN v;
END;
$$;
CREATE FUNCTION public.erp_date(p_value jsonb)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp AS $$
DECLARE v text := public.erp_text(p_value, 'dueDate', true);
BEGIN
  IF v <> '' THEN
    IF v !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN RAISE EXCEPTION 'Invalid dueDate' USING ERRCODE = '22023'; END IF;
    PERFORM v::date;
  END IF;
  RETURN v;
END;
$$;
CREATE FUNCTION public.erp_array(p_value jsonb, p_label text, p_nonempty boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp AS $$
BEGIN
  IF p_value IS NULL OR jsonb_typeof(p_value) <> 'array' THEN
    RAISE EXCEPTION '% must be an array', p_label USING ERRCODE = '22023';
  END IF;
  IF p_nonempty AND jsonb_array_length(p_value) = 0 THEN
    RAISE EXCEPTION '% must not be empty', p_label USING ERRCODE = '22023';
  END IF;
  RETURN p_value;
END;
$$;
CREATE FUNCTION public.erp_unit(p_value jsonb)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp AS $$
DECLARE v text := public.erp_text(p_value, 'unit');
BEGIN
  IF v NOT IN ('sheet', 'meter', 'squareMeter', 'piece', 'hole', 'minute', 'hour') THEN
    RAISE EXCEPTION 'Invalid operation unit' USING ERRCODE = '22023';
  END IF;
  RETURN v;
END;
$$;
CREATE FUNCTION public.erp_ticket_context(p_value jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp AS $$
DECLARE
  v_page text;
  v_revision numeric;
  v_sync text;
  v_pending numeric;
  v_build text;
  v_error jsonb;
  v_text text;
  v_result jsonb := '[]'::jsonb;
BEGIN
  IF p_value IS NULL OR jsonb_typeof(p_value) = 'null' THEN RETURN NULL; END IF;
  IF jsonb_typeof(p_value) <> 'object' THEN
    RAISE EXCEPTION 'Invalid ticket context' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_value -> 'page') IS DISTINCT FROM 'string' THEN
    RAISE EXCEPTION 'Invalid ticket context' USING ERRCODE = '22023';
  END IF;
  v_page := btrim(p_value ->> 'page');
  IF v_page = '' OR length(v_page) > 40 THEN RAISE EXCEPTION 'Invalid ticket context' USING ERRCODE = '22023'; END IF;
  IF jsonb_typeof(p_value -> 'revision') IS DISTINCT FROM 'number' THEN
    RAISE EXCEPTION 'Invalid ticket context' USING ERRCODE = '22023';
  END IF;
  v_revision := (p_value ->> 'revision')::numeric;
  IF v_revision <> trunc(v_revision) OR v_revision < 0 OR v_revision > 9007199254740991 THEN
    RAISE EXCEPTION 'Invalid ticket context' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_value -> 'sync') IS DISTINCT FROM 'string' OR (p_value ->> 'sync') NOT IN ('online', 'offline') THEN
    RAISE EXCEPTION 'Invalid ticket context' USING ERRCODE = '22023';
  END IF;
  v_sync := p_value ->> 'sync';
  IF jsonb_typeof(p_value -> 'pending') IS DISTINCT FROM 'number' THEN
    RAISE EXCEPTION 'Invalid ticket context' USING ERRCODE = '22023';
  END IF;
  v_pending := (p_value ->> 'pending')::numeric;
  IF v_pending <> trunc(v_pending) OR v_pending < 0 OR v_pending > 999 THEN
    RAISE EXCEPTION 'Invalid ticket context' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_value -> 'build') IS DISTINCT FROM 'string' THEN
    RAISE EXCEPTION 'Invalid ticket context' USING ERRCODE = '22023';
  END IF;
  v_build := btrim(p_value ->> 'build');
  IF v_build = '' OR length(v_build) > 60 THEN RAISE EXCEPTION 'Invalid ticket context' USING ERRCODE = '22023'; END IF;
  IF jsonb_typeof(p_value -> 'errors') IS DISTINCT FROM 'array' OR jsonb_array_length(p_value -> 'errors') > 5 THEN
    RAISE EXCEPTION 'Invalid ticket context' USING ERRCODE = '22023';
  END IF;
  FOR v_error IN SELECT value FROM jsonb_array_elements(p_value -> 'errors') LOOP
    IF jsonb_typeof(v_error) IS DISTINCT FROM 'string' THEN
      RAISE EXCEPTION 'Invalid ticket context' USING ERRCODE = '22023';
    END IF;
    v_text := btrim(v_error #>> '{}');
    IF length(v_text) > 300 THEN RAISE EXCEPTION 'Invalid ticket context' USING ERRCODE = '22023'; END IF;
    v_result := v_result || jsonb_build_array(v_text);
  END LOOP;
  RETURN jsonb_build_object('page', v_page, 'revision', v_revision, 'sync', v_sync,
    'pending', v_pending, 'build', v_build, 'errors', v_result);
END;
$$;
CREATE FUNCTION public.erp_current_profile()
RETURNS public.erp_profiles LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v public.erp_profiles%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v FROM public.erp_profiles WHERE id = auth.uid();
  IF NOT FOUND THEN RAISE EXCEPTION 'Account has not been linked to a company' USING ERRCODE = '42501'; END IF;
  IF v.role = 'worker' AND NOT EXISTS (SELECT 1 FROM public.erp_employees WHERE id = v.employee_id AND active) THEN
    RAISE EXCEPTION 'Employee is inactive' USING ERRCODE = '42501';
  END IF;
  RETURN v;
END;
$$;
CREATE FUNCTION public.erp_current_company_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT company_id FROM public.erp_profiles WHERE id = auth.uid();
$$;
CREATE FUNCTION public.erp_is_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM public.erp_profiles WHERE id = auth.uid() AND role = 'admin');
$$;

-- Direct reads stay inside the caller's company and are admin-only; writes go through erp_execute.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'erp_metadata', 'erp_customers', 'erp_suppliers', 'erp_employees', 'erp_profiles', 'erp_machines',
    'erp_operations', 'erp_items', 'erp_recipes', 'erp_recipe_versions', 'erp_recipe_components',
    'erp_orders', 'erp_order_items', 'erp_order_materials', 'erp_tasks',
    'erp_purchases', 'erp_purchase_lines', 'erp_stock_movements', 'erp_cash',
    'erp_work_reports', 'erp_payroll', 'erp_defects', 'erp_salary_plans', 'erp_expense_plans', 'erp_loans', 'erp_route_templates', 'erp_worker_deductions', 'erp_shipments', 'erp_shipment_lines', 'erp_support_tickets', 'erp_audit'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT SELECT ON TABLE public.%I TO authenticated', t);
    EXECUTE format('CREATE POLICY erp_admin_read ON public.%I FOR SELECT TO authenticated USING (company_id = public.erp_current_company_id() AND public.erp_is_admin())', t);
  END LOOP;
END;
$$;
ALTER TABLE public.erp_companies ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.erp_companies FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.erp_companies TO authenticated;
CREATE POLICY erp_company_read ON public.erp_companies FOR SELECT TO authenticated USING (id = public.erp_current_company_id());
CREATE POLICY erp_profile_self_read ON public.erp_profiles FOR SELECT TO authenticated USING (id = auth.uid());

CREATE FUNCTION public.erp_stock_qty(p_company_id uuid, p_item_id uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce(sum(CASE direction WHEN 'in' THEN qty ELSE -qty END), 0)
  FROM public.erp_stock_movements WHERE company_id = p_company_id AND item_id = p_item_id;
$$;
CREATE FUNCTION public.erp_reserved_qty(p_company_id uuid, p_item_id uuid, p_exclude_order uuid DEFAULT NULL)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce(sum(m.qty - m.issued_qty), 0) FROM public.erp_order_materials m
  JOIN public.erp_orders o ON o.company_id = m.company_id AND o.id = m.order_id
  WHERE m.company_id = p_company_id AND m.item_id = p_item_id AND o.status = 'production'
    AND (p_exclude_order IS NULL OR o.id <> p_exclude_order);
$$;
CREATE FUNCTION public.erp_balance(p_company_id uuid, p_account text)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce(sum(
    CASE WHEN account = p_account THEN CASE direction WHEN 'in' THEN amount ELSE -amount END ELSE 0 END
    + CASE WHEN direction = 'transfer' AND to_account = p_account THEN amount ELSE 0 END
  ), 0) FROM public.erp_cash WHERE company_id = p_company_id;
$$;
-- Sequential cash document number: PKO-0001 / RKO-0001 per direction, skipping transfers.
CREATE FUNCTION public.erp_cash_number(p_company_id uuid, p_direction text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT (CASE WHEN p_direction = 'in' THEN 'PKO-' ELSE 'RKO-' END) ||
    lpad(((SELECT count(*) FROM public.erp_cash c WHERE c.company_id = p_company_id
      AND c.direction = p_direction AND c.number IS NOT NULL) + 1)::text, 4, '0');
$$;
CREATE FUNCTION public.erp_paid(p_company_id uuid, p_source text, p_source_id uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce(sum(CASE direction WHEN 'out' THEN amount ELSE -amount END), 0)
  FROM public.erp_cash WHERE company_id = p_company_id AND source = p_source AND source_id = p_source_id;
$$;
-- Net customer payments, then FIFO across live shipments; the remainder is free advance.
CREATE FUNCTION public.erp_customer_advance(p_company_id uuid, p_customer_id uuid)
RETURNS numeric LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_payments numeric; v_allocated numeric;
BEGIN
  SELECT round(coalesce(sum(CASE direction WHEN 'in' THEN amount WHEN 'out' THEN -amount ELSE 0 END), 0)
    + coalesce((SELECT sum(CASE WHEN direction = 'deduct' THEN amount ELSE -amount END)
      FROM public.erp_worker_deductions WHERE company_id = p_company_id AND customer_id = p_customer_id), 0), 2)
    INTO v_payments
    FROM public.erp_cash WHERE company_id = p_company_id AND source = 'sale' AND customer_id = p_customer_id;
  v_payments := greatest(v_payments, 0);
  SELECT least(v_payments, coalesce(sum(total), 0)) INTO v_allocated FROM (
    SELECT round(sum(l.qty * l.sale_price), 2) AS total
    FROM public.erp_shipments s
    JOIN public.erp_shipment_lines l ON l.company_id = s.company_id AND l.shipment_id = s.id
    WHERE s.company_id = p_company_id AND s.customer_id = p_customer_id AND s.status <> 'cancelled'
    GROUP BY s.id) rows;
  RETURN round(greatest(v_payments - v_allocated, 0), 2);
END;
$$;
-- Mirrors the frontend order ledger: shipment FIFO first, then free advance in order sequence.
CREATE FUNCTION public.erp_order_paid(p_company_id uuid, p_order_id uuid)
RETURNS numeric LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_customer uuid; v_price numeric; v_payments numeric; v_free numeric; v_paid numeric;
BEGIN
  SELECT customer_id, price INTO v_customer, v_price FROM public.erp_orders
    WHERE company_id = p_company_id AND id = p_order_id;
  IF NOT FOUND OR v_customer IS NULL THEN RETURN 0; END IF;
  SELECT round(coalesce(sum(CASE direction WHEN 'in' THEN amount WHEN 'out' THEN -amount ELSE 0 END), 0)
    + coalesce((SELECT sum(CASE WHEN direction = 'deduct' THEN amount ELSE -amount END)
      FROM public.erp_worker_deductions WHERE company_id = p_company_id AND customer_id = v_customer), 0), 2)
    INTO v_payments
    FROM public.erp_cash WHERE company_id = p_company_id AND source = 'sale' AND customer_id = v_customer;
  v_payments := greatest(v_payments, 0);
  v_free := public.erp_customer_advance(p_company_id, v_customer);
  WITH shipments AS (
    SELECT s.id, s.order_id, round(sum(l.qty * l.sale_price), 2) AS total, s.created_at
    FROM public.erp_shipments s
    JOIN public.erp_shipment_lines l ON l.company_id = s.company_id AND l.shipment_id = s.id
    WHERE s.company_id = p_company_id AND s.customer_id = v_customer AND s.status <> 'cancelled'
    GROUP BY s.id, s.order_id, s.created_at
  ), ordered AS (
    SELECT *, coalesce(sum(total) OVER (ORDER BY created_at, id ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0) AS prior
    FROM shipments
  ), alloc AS (
    SELECT order_id, greatest(0, least(total, v_payments - prior)) AS paid FROM ordered
  ), settled AS (
    SELECT order_id, sum(paid) AS paid FROM alloc GROUP BY order_id
  ), ranked AS (
    SELECT o.id, o.price, coalesce(st.paid, 0) AS settled,
      greatest(0, o.price - coalesce(st.paid, 0)) AS remaining,
      coalesce(sum(greatest(0, o.price - coalesce(st.paid, 0)))
        OVER (ORDER BY o.created_at, o.id ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0) AS prior
    FROM public.erp_orders o
    LEFT JOIN settled st ON st.order_id = o.id
    WHERE o.company_id = p_company_id AND o.customer_id = v_customer AND o.status <> 'cancelled'
  ), target AS (
    SELECT settled, remaining, prior FROM ranked WHERE id = p_order_id
  )
  SELECT least(v_price, t.settled + greatest(0, least(v_free - t.prior, t.remaining))) INTO v_paid
    FROM target t;
  RETURN coalesce(v_paid, 0);
END;
$$;
CREATE FUNCTION public.erp_supplier_cost(p_company_id uuid, p_supplier_id uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  -- Received goods and accepted outsourced work, each line rounded exactly like the frontend ledger.
  SELECT coalesce((SELECT sum(round(m.qty * m.unit_cost, 2))
    FROM public.erp_stock_movements m JOIN public.erp_purchases p ON p.company_id = m.company_id AND p.id = m.source_id
    WHERE m.company_id = p_company_id AND m.source = 'purchase' AND m.direction = 'in' AND p.supplier_id = p_supplier_id), 0)
    + coalesce((SELECT sum(CASE WHEN t.supplier_cost > 0 THEN round(t.supplier_cost, 2) ELSE round(t.completed * t.rate, 2) END) FROM public.erp_tasks t
      WHERE t.company_id = p_company_id AND t.supplier_id = p_supplier_id
        AND t.executor_kind = 'supplier' AND t.status = 'completed'), 0);
$$;
CREATE FUNCTION public.erp_insert_components(p_company_id uuid, p_version_id uuid, p_components jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_line jsonb; v_allow jsonb; v_pos integer := 0; v_slot text; v_item uuid; v_id uuid;
  v_ids uuid[]; v_qty numeric;
BEGIN
  IF p_components IS NULL OR jsonb_typeof(p_components) <> 'array' OR jsonb_array_length(p_components) = 0 THEN
    RAISE EXCEPTION 'Recipe requires components' USING ERRCODE = '22023';
  END IF;
  FOR v_line IN SELECT value FROM jsonb_array_elements(p_components) LOOP
    IF jsonb_typeof(v_line) <> 'object' THEN RAISE EXCEPTION 'Recipe component must be an object' USING ERRCODE = '22023'; END IF;
    v_slot := btrim(public.erp_text(v_line -> 'slot', 'slot'));
    v_qty := public.erp_num(v_line -> 'qtyPerUnit', 'qtyPerUnit');
    IF NOT (v_line ? 'itemId') THEN RAISE EXCEPTION 'itemId is required (UUID or null)' USING ERRCODE = '22023'; END IF;
    v_item := CASE WHEN v_line -> 'itemId' = 'null'::jsonb THEN NULL ELSE public.erp_uuid(v_line -> 'itemId', 'itemId') END;
    v_ids := ARRAY[]::uuid[];
    FOR v_allow IN SELECT value FROM jsonb_array_elements(coalesce(v_line -> 'allowedItemIds', '[]'::jsonb)) LOOP
      v_id := public.erp_uuid(v_allow, 'allowedItemIds');
      IF v_id = ANY(v_ids) THEN RAISE EXCEPTION 'Duplicate allowed item' USING ERRCODE = '22023'; END IF;
      v_ids := v_ids || v_id;
    END LOOP;
    IF v_item IS NULL AND cardinality(v_ids) = 0 THEN
      RAISE EXCEPTION 'Slot requires a default or allowed item' USING ERRCODE = '22023';
    END IF;
    IF v_item IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.erp_items
      WHERE company_id = p_company_id AND id = v_item AND customer_id IS NULL) THEN
      RAISE EXCEPTION 'Recipe item not found or customer-owned' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM public.erp_items
      WHERE company_id = p_company_id AND id = ANY(v_ids) AND customer_id IS NOT NULL)
      OR EXISTS (SELECT 1 FROM unnest(v_ids) AS a(id)
        WHERE NOT EXISTS (SELECT 1 FROM public.erp_items i WHERE i.company_id = p_company_id AND i.id = a.id)) THEN
      RAISE EXCEPTION 'Recipe item not found or customer-owned' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM public.erp_recipe_components c
      WHERE c.company_id = p_company_id AND c.version_id = p_version_id AND lower(c.slot) = lower(v_slot)) THEN
      RAISE EXCEPTION 'Duplicate recipe slot' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.erp_recipe_components(company_id, version_id, position, slot, item_id, allowed_item_ids, qty_per_unit)
      VALUES (p_company_id, p_version_id, v_pos, v_slot, v_item, v_ids, v_qty);
    v_pos := v_pos + 1;
  END LOOP;
END;
$$;
CREATE FUNCTION public.erp_assert_recipes(p_company_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF EXISTS (
    WITH RECURSIVE edges AS (
      SELECT r.output_item_id AS from_item, c.item_id AS to_item
      FROM public.erp_recipes r
      JOIN public.erp_recipe_versions v ON v.company_id = r.company_id AND v.recipe_id = r.id
      JOIN public.erp_recipe_components c ON c.company_id = v.company_id AND c.version_id = v.id
      WHERE r.company_id = p_company_id AND c.item_id IS NOT NULL
      UNION
      SELECT r.output_item_id, a.item_id
      FROM public.erp_recipes r
      JOIN public.erp_recipe_versions v ON v.company_id = r.company_id AND v.recipe_id = r.id
      JOIN public.erp_recipe_components c ON c.company_id = v.company_id AND c.version_id = v.id
      CROSS JOIN LATERAL unnest(c.allowed_item_ids) AS a(item_id)
      WHERE r.company_id = p_company_id
    ), walk AS (
      SELECT e.from_item AS start, e.to_item AS node, ARRAY[e.from_item, e.to_item] AS path, 1 AS depth FROM edges e
      UNION ALL
      SELECT w.start, e.to_item, w.path || e.to_item, w.depth + 1
      FROM walk w JOIN edges e ON e.from_item = w.node
      WHERE w.depth < 64
    )
    SELECT 1 FROM walk w WHERE w.depth > 1 AND array_position(w.path, w.node) < w.depth LIMIT 1
  ) THEN
    RAISE EXCEPTION 'Recipe graph contains a cycle' USING ERRCODE = '23514';
  END IF;
END;
$$;
CREATE FUNCTION public.erp_insert_route(p_company_id uuid, p_order_id uuid, p_line_id uuid, p_qty numeric, p_lines jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_line jsonb; v_pos integer; v_stage numeric; v_operation public.erp_operations%ROWTYPE;
  v_kind text; v_employee uuid; v_supplier uuid;
BEGIN
  SELECT coalesce(max(position), -1) + 1 INTO v_pos FROM public.erp_tasks
    WHERE company_id = p_company_id AND order_id = p_order_id;
  FOR v_line IN SELECT value FROM jsonb_array_elements(public.erp_array(coalesce(p_lines, '[]'::jsonb), 'route', true)) LOOP
    SELECT * INTO v_operation FROM public.erp_operations WHERE company_id = p_company_id
      AND id = public.erp_uuid(v_line -> 'operationId', 'operationId');
    IF NOT FOUND THEN RAISE EXCEPTION 'Operation not found' USING ERRCODE = '22023'; END IF;
    IF NOT v_operation.active THEN RAISE EXCEPTION 'Operation is inactive' USING ERRCODE = '23514'; END IF;
    -- Legacy payloads carry no executorKind and must keep behaving exactly like an employee stage.
    v_kind := coalesce(v_line ->> 'executorKind', 'employee');
    v_employee := CASE WHEN v_line ? 'employeeId' AND btrim(v_line ->> 'employeeId') <> ''
      THEN public.erp_uuid(v_line -> 'employeeId', 'employeeId') ELSE NULL END;
    v_supplier := CASE WHEN v_line ? 'supplierId' AND btrim(v_line ->> 'supplierId') <> ''
      THEN public.erp_uuid(v_line -> 'supplierId', 'supplierId') ELSE NULL END;
    IF v_kind = 'employee' THEN
      IF v_employee IS NULL OR v_supplier IS NOT NULL THEN
        RAISE EXCEPTION 'Employee stage requires exactly one employee' USING ERRCODE = '23514';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM public.erp_employees WHERE company_id = p_company_id AND id = v_employee AND active) THEN
        RAISE EXCEPTION 'Active employee not found' USING ERRCODE = '22023';
      END IF;
      IF NOT (v_employee = ANY(v_operation.employee_ids)) THEN
        RAISE EXCEPTION 'Employee is not authorized for this operation' USING ERRCODE = '23514';
      END IF;
    ELSIF v_kind = 'supplier' THEN
      IF v_employee IS NOT NULL OR v_supplier IS NULL THEN
        RAISE EXCEPTION 'Supplier stage requires exactly one supplier' USING ERRCODE = '23514';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM public.erp_suppliers WHERE company_id = p_company_id AND id = v_supplier) THEN
        RAISE EXCEPTION 'Supplier not found' USING ERRCODE = '22023';
      END IF;
      IF (SELECT kind FROM public.erp_orders WHERE company_id = p_company_id AND id = p_order_id) = 'series' THEN
        RAISE EXCEPTION 'Series production uses employees only' USING ERRCODE = '23514';
      END IF;
    ELSE
      RAISE EXCEPTION 'Invalid executor kind' USING ERRCODE = '22023';
    END IF;
    -- A stage plans its own volume (sheets, metres, holes); older payloads fall back to the position quantity.
    v_stage := CASE WHEN v_line -> 'qty' IS NOT NULL THEN public.erp_num(v_line -> 'qty', 'stage qty') ELSE p_qty END;
    INSERT INTO public.erp_tasks(company_id, order_id, line_id, position, operation_id, name, executor_kind,
      employee_id, supplier_id, rate, supplier_cost, sale_price, standard_minutes, planned)
      VALUES (p_company_id, p_order_id, p_line_id, v_pos, v_operation.id, v_operation.name, v_kind, v_employee,
        v_supplier, public.erp_money(v_line -> 'rate', 'route rate', true),
        CASE WHEN v_kind = 'supplier' AND v_line ? 'supplierCost'
          THEN public.erp_money(v_line -> 'supplierCost', 'supplier cost', true) ELSE 0 END,
        v_operation.sale_price, v_operation.standard_minutes, v_stage);
    v_pos := v_pos + 1;
  END LOOP;
END;
$$;
CREATE FUNCTION public.erp_insert_materials(p_company_id uuid, p_order_id uuid, p_line_id uuid, p_customer_id uuid, p_items jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_line jsonb; v_pos integer; v_id uuid; v_item public.erp_items%ROWTYPE;
BEGIN
  SELECT coalesce(max(position), -1) + 1 INTO v_pos FROM public.erp_order_materials
    WHERE company_id = p_company_id AND order_id = p_order_id;
  FOR v_line IN SELECT value FROM jsonb_array_elements(public.erp_array(coalesce(p_items, '[]'::jsonb), 'materials')) LOOP
    v_id := public.erp_uuid(v_line -> 'itemId', 'itemId');
    SELECT * INTO v_item FROM public.erp_items WHERE company_id = p_company_id AND id = v_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Material item not found' USING ERRCODE = '22023'; END IF;
    IF v_item.customer_id IS NOT NULL AND v_item.customer_id <> p_customer_id THEN
      RAISE EXCEPTION 'Material belongs to another customer' USING ERRCODE = '23514';
    END IF;
    INSERT INTO public.erp_order_materials(company_id, order_id, line_id, item_id, position, qty, estimated_cost)
      VALUES (p_company_id, p_order_id, p_line_id, v_id, v_pos, public.erp_num(v_line -> 'qty', 'material qty'),
        CASE WHEN v_item.customer_id IS NULL THEN v_item.cost ELSE 0 END);
    v_pos := v_pos + 1;
  END LOOP;
END;
$$;
CREATE FUNCTION public.erp_norms(p_company_id uuid, p_norms jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_norm jsonb; v_item public.erp_items%ROWTYPE; v_seen uuid[] := ARRAY[]::uuid[];
  v_id uuid; v_qty numeric; v_result jsonb := '[]'::jsonb;
BEGIN
  IF p_norms IS NULL OR p_norms = 'null'::jsonb THEN RETURN '[]'::jsonb; END IF;
  FOR v_norm IN SELECT value FROM jsonb_array_elements(public.erp_array(p_norms, 'norms')) LOOP
    v_id := public.erp_uuid(v_norm -> 'itemId', 'norm itemId');
    IF v_id = ANY(v_seen) THEN RAISE EXCEPTION 'Duplicate norm item' USING ERRCODE = '22023'; END IF;
    SELECT * INTO v_item FROM public.erp_items WHERE company_id = p_company_id AND id = v_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Norm item not found' USING ERRCODE = '22023'; END IF;
    IF v_item.customer_id IS NOT NULL THEN RAISE EXCEPTION 'Norm material must be a business item' USING ERRCODE = '23514'; END IF;
    v_qty := public.erp_num(v_norm -> 'qtyPerM2', 'qtyPerM2');
    IF v_qty <= 0 THEN RAISE EXCEPTION 'Invalid quantity' USING ERRCODE = '22023'; END IF;
    v_seen := v_seen || v_id;
    v_result := v_result || jsonb_build_array(jsonb_build_object('itemId', v_id, 'qtyPerM2', v_qty));
  END LOOP;
  RETURN v_result;
END;
$$;
CREATE FUNCTION public.erp_route_template_stage(p_company_id uuid, p_stage jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_operation public.erp_operations%ROWTYPE;
  v_kind text;
  v_rate numeric;
  v_employee_id uuid;
  v_supplier_id uuid;
BEGIN
  IF p_stage IS NULL OR jsonb_typeof(p_stage) <> 'object' THEN
    RAISE EXCEPTION 'stage must be an object' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_operation FROM public.erp_operations
    WHERE company_id = p_company_id AND id = public.erp_uuid(p_stage -> 'operationId', 'operationId');
  IF NOT FOUND THEN RAISE EXCEPTION 'Operation not found' USING ERRCODE = '22023'; END IF;
  IF NOT v_operation.active THEN RAISE EXCEPTION 'Operation is inactive' USING ERRCODE = '22023'; END IF;
  v_kind := coalesce(p_stage ->> 'executorKind', 'employee');
  IF v_kind NOT IN ('employee', 'supplier') THEN RAISE EXCEPTION 'Invalid executor kind' USING ERRCODE = '22023'; END IF;
  IF p_stage ? 'employeeId' AND p_stage -> 'employeeId' <> 'null'::jsonb THEN
    v_employee_id := public.erp_uuid(p_stage -> 'employeeId', 'employeeId');
  END IF;
  IF p_stage ? 'supplierId' AND p_stage -> 'supplierId' <> 'null'::jsonb THEN
    v_supplier_id := public.erp_uuid(p_stage -> 'supplierId', 'supplierId');
  END IF;
  IF v_kind = 'employee' THEN
    IF v_supplier_id IS NOT NULL THEN RAISE EXCEPTION 'Employee stage requires no supplier' USING ERRCODE = '22023'; END IF;
    IF v_employee_id IS NOT NULL THEN
      IF NOT EXISTS (SELECT 1 FROM public.erp_employees WHERE company_id = p_company_id AND id = v_employee_id AND active) THEN
        RAISE EXCEPTION 'Employee is inactive' USING ERRCODE = '22023';
      END IF;
      IF NOT (v_employee_id = ANY(v_operation.employee_ids)) THEN
        RAISE EXCEPTION 'Employee is not authorized for this operation' USING ERRCODE = '22023';
      END IF;
    END IF;
  ELSE
    IF v_employee_id IS NOT NULL THEN RAISE EXCEPTION 'Supplier stage requires no employee' USING ERRCODE = '22023'; END IF;
    IF v_supplier_id IS NULL THEN RAISE EXCEPTION 'Supplier stage requires a supplier' USING ERRCODE = '22023'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.erp_suppliers WHERE company_id = p_company_id AND id = v_supplier_id) THEN
      RAISE EXCEPTION 'Supplier not found' USING ERRCODE = '22023';
    END IF;
  END IF;
  RETURN jsonb_strip_nulls(jsonb_build_object(
    'operationId', v_operation.id::text,
    'executorKind', v_kind,
    'rate', CASE WHEN p_stage ? 'rate' THEN public.erp_money(p_stage -> 'rate', 'rate', true) END,
    'employeeId', CASE WHEN v_employee_id IS NOT NULL THEN v_employee_id::text END,
    'supplierId', CASE WHEN v_supplier_id IS NOT NULL THEN v_supplier_id::text END
  ));
END;
$$;
CREATE FUNCTION public.erp_insert_norm_materials(p_company_id uuid, p_order_id uuid, p_line_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_task record; v_norm jsonb; v_item public.erp_items%ROWTYPE; v_pos integer;
  v_qty numeric; v_item_id uuid; v_existing public.erp_order_materials%ROWTYPE;
BEGIN
  SELECT coalesce(max(position), -1) + 1 INTO v_pos FROM public.erp_order_materials
    WHERE company_id = p_company_id AND order_id = p_order_id;
  FOR v_task IN SELECT t.planned AS area, op.norms AS norms
    FROM public.erp_tasks t JOIN public.erp_operations op
      ON op.company_id = t.company_id AND op.id = t.operation_id
    WHERE t.company_id = p_company_id AND t.order_id = p_order_id AND t.line_id = p_line_id
      AND op.unit = 'squareMeter' AND jsonb_array_length(op.norms) > 0 LOOP
    FOR v_norm IN SELECT value FROM jsonb_array_elements(v_task.norms) LOOP
      v_item_id := public.erp_uuid(v_norm -> 'itemId', 'norm itemId');
      SELECT * INTO v_item FROM public.erp_items WHERE company_id = p_company_id AND id = v_item_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'Norm item not found' USING ERRCODE = '22023'; END IF;
      IF v_item.customer_id IS NOT NULL THEN RAISE EXCEPTION 'Norm material must be a business item' USING ERRCODE = '23514'; END IF;
      v_qty := public.erp_num(v_norm -> 'qtyPerM2', 'qtyPerM2') * v_task.area;
      SELECT * INTO v_existing FROM public.erp_order_materials
        WHERE company_id = p_company_id AND order_id = p_order_id AND line_id = p_line_id AND item_id = v_item_id;
      IF FOUND THEN
        UPDATE public.erp_order_materials SET qty = qty + v_qty
          WHERE company_id = p_company_id AND id = v_existing.id;
      ELSE
        INSERT INTO public.erp_order_materials(company_id, order_id, line_id, item_id, position, qty, estimated_cost)
          VALUES (p_company_id, p_order_id, p_line_id, v_item_id, v_pos, v_qty, v_item.cost);
        v_pos := v_pos + 1;
      END IF;
    END LOOP;
  END LOOP;
END;
$$;
CREATE FUNCTION public.erp_task_started(p_company_id uuid, p_order_id uuid, p_task_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM public.erp_tasks t WHERE t.company_id = p_company_id AND t.id = p_task_id
    AND (t.status <> 'assigned' OR t.completed > 0
      OR EXISTS (SELECT 1 FROM public.erp_work_reports r
        WHERE r.company_id = p_company_id AND r.order_id = p_order_id AND r.task_id = p_task_id)));
$$;
-- Revision of one position's materials: issued rows freeze, everything else follows the submitted order.
CREATE FUNCTION public.erp_revise_materials(p_company_id uuid, p_order_id uuid, p_line_id uuid, p_customer_id uuid, p_items jsonb, p_pos integer)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_line jsonb; v_pos integer := p_pos; v_id uuid; v_item public.erp_items%ROWTYPE; v_material public.erp_order_materials%ROWTYPE;
BEGIN
  v_line := public.erp_array(coalesce(p_items, '[]'::jsonb), 'materials');
  IF (SELECT count(*) FROM jsonb_array_elements(v_line)) <> (SELECT count(DISTINCT public.erp_uuid(l.value -> 'itemId', 'itemId')) FROM jsonb_array_elements(v_line) l) THEN
    RAISE EXCEPTION 'Duplicate material' USING ERRCODE = '22023';
  END IF;
  FOR v_material IN SELECT * FROM public.erp_order_materials
    WHERE company_id = p_company_id AND line_id = p_line_id AND issued_qty > 0 LOOP
    IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_line) l
      WHERE public.erp_uuid(l.value -> 'itemId', 'itemId') = v_material.item_id) THEN
      RAISE EXCEPTION 'Issued material cannot be removed' USING ERRCODE = '23514';
    END IF;
  END LOOP;
  DELETE FROM public.erp_order_materials m WHERE m.company_id = p_company_id AND m.line_id = p_line_id AND m.issued_qty = 0
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_line) l
      WHERE public.erp_uuid(l.value -> 'itemId', 'itemId') = m.item_id);
  FOR v_line IN SELECT value FROM jsonb_array_elements(v_line) LOOP
    v_id := public.erp_uuid(v_line -> 'itemId', 'itemId');
    SELECT * INTO v_item FROM public.erp_items WHERE company_id = p_company_id AND id = v_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Material item not found' USING ERRCODE = '22023'; END IF;
    IF v_item.customer_id IS NOT NULL AND v_item.customer_id <> p_customer_id THEN
      RAISE EXCEPTION 'Material belongs to another customer' USING ERRCODE = '23514';
    END IF;
    SELECT * INTO v_material FROM public.erp_order_materials
      WHERE company_id = p_company_id AND line_id = p_line_id AND item_id = v_id;
    IF FOUND THEN
      UPDATE public.erp_order_materials SET position = v_pos, line_id = p_line_id,
        qty = CASE WHEN v_material.issued_qty > 0
          THEN greatest(public.erp_num(v_line -> 'qty', 'material qty', true), v_material.issued_qty)
          ELSE public.erp_num(v_line -> 'qty', 'material qty') END,
        estimated_cost = CASE WHEN v_material.issued_qty > 0 THEN v_material.estimated_cost
          WHEN v_item.customer_id IS NULL THEN v_item.cost ELSE 0 END
        WHERE company_id = p_company_id AND id = v_material.id;
    ELSE
      INSERT INTO public.erp_order_materials(company_id, order_id, line_id, item_id, position, qty, estimated_cost)
        VALUES (p_company_id, p_order_id, p_line_id, v_id, v_pos, public.erp_num(v_line -> 'qty', 'material qty'),
          CASE WHEN v_item.customer_id IS NULL THEN v_item.cost ELSE 0 END);
    END IF;
    v_pos := v_pos + 1;
  END LOOP;
  RETURN v_pos;
END;
$$;
-- Paint norms follow the routed area: a revised stage quantity moves square-metre materials by the difference.
CREATE FUNCTION public.erp_norm_delta(p_company_id uuid, p_order_id uuid, p_line_id uuid, p_customer_id uuid, p_before jsonb, p_after jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_norm record; v_rule record; v_before numeric; v_after numeric; v_delta numeric; v_qty numeric;
  v_pos integer; v_found boolean; v_material public.erp_order_materials%ROWTYPE; v_item public.erp_items%ROWTYPE;
BEGIN
  FOR v_norm IN
    SELECT o.id AS operation_id, o.norms FROM public.erp_operations o
    WHERE o.company_id = p_company_id AND o.unit = 'squareMeter' AND jsonb_array_length(o.norms) > 0
      AND o.id IN (
        SELECT public.erp_uuid(value -> 'operationId', 'operationId') FROM jsonb_array_elements(coalesce(p_before, '[]'::jsonb))
        UNION
        SELECT public.erp_uuid(value -> 'operationId', 'operationId') FROM jsonb_array_elements(coalesce(p_after, '[]'::jsonb)))
  LOOP
    SELECT coalesce(sum(public.erp_num(value -> 'planned', 'planned')), 0) INTO v_before
      FROM jsonb_array_elements(coalesce(p_before, '[]'::jsonb))
      WHERE public.erp_uuid(value -> 'operationId', 'operationId') = v_norm.operation_id;
    SELECT coalesce(sum(public.erp_num(value -> 'planned', 'planned')), 0) INTO v_after
      FROM jsonb_array_elements(coalesce(p_after, '[]'::jsonb))
      WHERE public.erp_uuid(value -> 'operationId', 'operationId') = v_norm.operation_id;
    IF v_after = v_before THEN CONTINUE; END IF;
    FOR v_rule IN SELECT public.erp_uuid(value -> 'itemId', 'itemId') AS item_id,
        public.erp_num(value -> 'qtyPerM2', 'qtyPerM2') AS per_m2
      FROM jsonb_array_elements(v_norm.norms) LOOP
      SELECT * INTO v_item FROM public.erp_items WHERE company_id = p_company_id AND id = v_rule.item_id;
      IF NOT FOUND OR v_item.customer_id IS NOT NULL THEN CONTINUE; END IF;
      v_delta := round(v_rule.per_m2 * (v_after - v_before), 3);
      IF v_delta = 0 THEN CONTINUE; END IF;
      SELECT * INTO v_material FROM public.erp_order_materials
        WHERE company_id = p_company_id AND line_id = p_line_id AND item_id = v_rule.item_id FOR UPDATE;
      v_found := FOUND;
      IF v_delta > 0 THEN
        IF v_found THEN
          UPDATE public.erp_order_materials SET qty = round(v_material.qty + v_delta, 3)
            WHERE company_id = p_company_id AND id = v_material.id;
        ELSE
          SELECT coalesce(max(position) + 1, 0) INTO v_pos
            FROM public.erp_order_materials WHERE company_id = p_company_id AND order_id = p_order_id;
          INSERT INTO public.erp_order_materials(company_id, order_id, line_id, item_id, position, qty, estimated_cost)
            VALUES (p_company_id, p_order_id, p_line_id, v_rule.item_id, v_pos, v_delta, v_item.cost);
        END IF;
      ELSIF v_found THEN
        v_qty := greatest(v_material.issued_qty, round(v_material.qty + v_delta, 3));
        IF v_qty <= 0 THEN
          DELETE FROM public.erp_order_materials WHERE company_id = p_company_id AND id = v_material.id;
        ELSE
          UPDATE public.erp_order_materials SET qty = v_qty WHERE company_id = p_company_id AND id = v_material.id;
        END IF;
      END IF;
    END LOOP;
  END LOOP;
END;
$$;
-- Revision of one position's route: accepted or reported stages freeze, the rest is rebuilt in the submitted order.
CREATE FUNCTION public.erp_revise_route(p_company_id uuid, p_order_id uuid, p_line_id uuid, p_qty numeric, p_lines jsonb, p_pos integer)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_line jsonb; v_pos integer := p_pos; v_id uuid; v_started boolean; v_stage numeric;
  v_kind text; v_employee uuid; v_supplier uuid;
  v_operation public.erp_operations%ROWTYPE; v_task public.erp_tasks%ROWTYPE;
BEGIN
  v_line := public.erp_array(coalesce(p_lines, '[]'::jsonb), 'route', true);
  IF (SELECT count(*) FROM jsonb_array_elements(v_line) l WHERE l.value ? 'taskId')
    <> (SELECT count(DISTINCT public.erp_uuid(l.value -> 'taskId', 'taskId')) FROM jsonb_array_elements(v_line) l WHERE l.value ? 'taskId') THEN
    RAISE EXCEPTION 'Duplicate task' USING ERRCODE = '22023';
  END IF;
  FOR v_task IN SELECT * FROM public.erp_tasks WHERE company_id = p_company_id AND line_id = p_line_id LOOP
    v_started := public.erp_task_started(p_company_id, p_order_id, v_task.id);
    IF v_started AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_line) l
      WHERE l.value ? 'taskId' AND public.erp_uuid(l.value -> 'taskId', 'taskId') = v_task.id
        AND public.erp_uuid(l.value -> 'operationId', 'operationId') = v_task.operation_id
        AND coalesce(l.value ->> 'executorKind', 'employee') = v_task.executor_kind
        AND CASE WHEN l.value ? 'employeeId' AND btrim(l.value ->> 'employeeId') <> ''
          THEN public.erp_uuid(l.value -> 'employeeId', 'employeeId') ELSE NULL END IS NOT DISTINCT FROM v_task.employee_id
        AND CASE WHEN l.value ? 'supplierId' AND btrim(l.value ->> 'supplierId') <> ''
          THEN public.erp_uuid(l.value -> 'supplierId', 'supplierId') ELSE NULL END IS NOT DISTINCT FROM v_task.supplier_id
        AND public.erp_money(l.value -> 'rate', 'route rate', true) = v_task.rate
        AND (v_task.executor_kind <> 'supplier' OR CASE WHEN v_task.supplier_cost > 0
          THEN CASE WHEN l.value ? 'supplierCost'
            THEN public.erp_money(l.value -> 'supplierCost', 'supplier cost', true) = v_task.supplier_cost
            ELSE false END
          ELSE CASE WHEN l.value ? 'supplierCost'
            THEN public.erp_money(l.value -> 'supplierCost', 'supplier cost', true) IN (0, round(v_task.planned * v_task.rate, 2))
            ELSE true END
        END)) THEN
      RAISE EXCEPTION 'Started stage cannot be removed or changed' USING ERRCODE = '23514';
    END IF;
  END LOOP;
  DELETE FROM public.erp_tasks t WHERE t.company_id = p_company_id AND t.line_id = p_line_id
    AND NOT public.erp_task_started(p_company_id, p_order_id, t.id)
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_line) l
      WHERE l.value ? 'taskId' AND public.erp_uuid(l.value -> 'taskId', 'taskId') = t.id);
  FOR v_line IN SELECT value FROM jsonb_array_elements(v_line) LOOP
    SELECT * INTO v_operation FROM public.erp_operations WHERE company_id = p_company_id
      AND id = public.erp_uuid(v_line -> 'operationId', 'operationId');
    IF NOT FOUND THEN RAISE EXCEPTION 'Operation not found' USING ERRCODE = '22023'; END IF;
    IF NOT v_operation.active THEN RAISE EXCEPTION 'Operation is inactive' USING ERRCODE = '23514'; END IF;
    v_kind := coalesce(v_line ->> 'executorKind', 'employee');
    v_employee := CASE WHEN v_line ? 'employeeId' AND btrim(v_line ->> 'employeeId') <> ''
      THEN public.erp_uuid(v_line -> 'employeeId', 'employeeId') ELSE NULL END;
    v_supplier := CASE WHEN v_line ? 'supplierId' AND btrim(v_line ->> 'supplierId') <> ''
      THEN public.erp_uuid(v_line -> 'supplierId', 'supplierId') ELSE NULL END;
    IF v_kind = 'employee' THEN
      IF v_employee IS NULL OR v_supplier IS NOT NULL THEN
        RAISE EXCEPTION 'Employee stage requires exactly one employee' USING ERRCODE = '23514';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM public.erp_employees WHERE company_id = p_company_id AND id = v_employee AND active) THEN
        RAISE EXCEPTION 'Active employee not found' USING ERRCODE = '22023';
      END IF;
      IF NOT (v_employee = ANY(v_operation.employee_ids)) THEN
        RAISE EXCEPTION 'Employee is not authorized for this operation' USING ERRCODE = '23514';
      END IF;
    ELSIF v_kind = 'supplier' THEN
      IF v_employee IS NOT NULL OR v_supplier IS NULL THEN
        RAISE EXCEPTION 'Supplier stage requires exactly one supplier' USING ERRCODE = '23514';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM public.erp_suppliers WHERE company_id = p_company_id AND id = v_supplier) THEN
        RAISE EXCEPTION 'Supplier not found' USING ERRCODE = '22023';
      END IF;
    ELSE
      RAISE EXCEPTION 'Invalid executor kind' USING ERRCODE = '22023';
    END IF;
    v_stage := CASE WHEN v_line -> 'qty' IS NOT NULL THEN public.erp_num(v_line -> 'qty', 'stage qty') ELSE p_qty END;
    IF v_line ? 'taskId' THEN
      SELECT * INTO v_task FROM public.erp_tasks
        WHERE company_id = p_company_id AND line_id = p_line_id AND id = public.erp_uuid(v_line -> 'taskId', 'taskId') FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Task not found' USING ERRCODE = '22023'; END IF;
      v_started := public.erp_task_started(p_company_id, p_order_id, v_task.id);
      IF v_started THEN
        IF v_task.completed > v_stage THEN RAISE EXCEPTION 'Stage quantity is below accepted work' USING ERRCODE = '23514'; END IF;
        UPDATE public.erp_tasks SET position = v_pos, operation_id = v_operation.id, name = v_operation.name,
          sale_price = v_operation.sale_price, standard_minutes = v_operation.standard_minutes, planned = v_stage,
          status = CASE WHEN v_task.status = 'completed' AND v_task.completed < v_stage THEN 'in_progress' ELSE v_task.status END
          WHERE company_id = p_company_id AND id = v_task.id;
      ELSE
        UPDATE public.erp_tasks SET position = v_pos, operation_id = v_operation.id, name = v_operation.name,
          executor_kind = v_kind, employee_id = v_employee, supplier_id = v_supplier,
          rate = public.erp_money(v_line -> 'rate', 'route rate', true),
          supplier_cost = CASE WHEN v_kind = 'supplier' AND v_line ? 'supplierCost'
            THEN public.erp_money(v_line -> 'supplierCost', 'supplier cost', true) ELSE 0 END,
          sale_price = v_operation.sale_price, standard_minutes = v_operation.standard_minutes,
          planned = v_stage, completed = 0, status = 'assigned' WHERE company_id = p_company_id AND id = v_task.id;
      END IF;
    ELSE
      INSERT INTO public.erp_tasks(company_id, order_id, line_id, position, operation_id, name, executor_kind,
        employee_id, supplier_id, rate, supplier_cost, sale_price, standard_minutes, planned)
        VALUES (p_company_id, p_order_id, p_line_id, v_pos, v_operation.id, v_operation.name, v_kind, v_employee,
          v_supplier, public.erp_money(v_line -> 'rate', 'route rate', true),
          CASE WHEN v_kind = 'supplier' AND v_line ? 'supplierCost'
            THEN public.erp_money(v_line -> 'supplierCost', 'supplier cost', true) ELSE 0 END,
          v_operation.sale_price, v_operation.standard_minutes, v_stage);
    END IF;
    v_pos := v_pos + 1;
  END LOOP;
  RETURN v_pos;
END;
$$;
-- Order identity follows its live positions, exactly as the frontend recomputes it.
CREATE FUNCTION public.erp_sync_identity(p_company_id uuid, p_order_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_kind text; v_title text;
BEGIN
  IF EXISTS (SELECT 1 FROM public.erp_orders WHERE company_id = p_company_id AND id = p_order_id AND kind = 'series') THEN
    RETURN;
  END IF;
  SELECT CASE WHEN count(DISTINCT row.kind) = 1 THEN min(row.kind) ELSE 'composite' END,
    string_agg(row.title, ' · ' ORDER BY row.position) INTO v_kind, v_title
    FROM public.erp_order_items row
    WHERE row.company_id = p_company_id AND row.order_id = p_order_id AND row.status <> 'cancelled';
  IF v_title IS NULL THEN RETURN; END IF;
  UPDATE public.erp_orders SET kind = v_kind, title = v_title WHERE company_id = p_company_id AND id = p_order_id;
END;
$$;
-- Quantity, contract price and aggregate status are always derived from the least advanced live position.
CREATE FUNCTION public.erp_sync_order(p_company_id uuid, p_order_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_qty numeric; v_price numeric; v_status text; v_markup numeric; v_series boolean;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.erp_order_items
    WHERE company_id = p_company_id AND order_id = p_order_id AND status <> 'cancelled') THEN
    UPDATE public.erp_orders SET status = 'cancelled' WHERE company_id = p_company_id AND id = p_order_id;
    RETURN;
  END IF;
  SELECT kind = 'series', coalesce(markup, 0) INTO v_series, v_markup
    FROM public.erp_orders WHERE company_id = p_company_id AND id = p_order_id;
  SELECT coalesce(sum(qty), 0), round(coalesce(sum(total), 0), 2),
    CASE min(CASE status WHEN 'draft' THEN 0 WHEN 'production' THEN 1 WHEN 'ready' THEN 2
      WHEN 'shipped' THEN 3 ELSE 4 END)
      WHEN 0 THEN 'draft' WHEN 1 THEN 'production' WHEN 2 THEN 'ready' WHEN 3 THEN 'shipped' ELSE 'delivered' END
    INTO v_qty, v_price, v_status
    FROM public.erp_order_items WHERE company_id = p_company_id AND order_id = p_order_id AND status <> 'cancelled';
  IF NOT coalesce(v_series, false) THEN v_price := round(v_price + coalesce(v_markup, 0), 2); END IF;
  IF v_price < 0 THEN RAISE EXCEPTION 'Markup exceeds order total' USING ERRCODE = '23514'; END IF;
  UPDATE public.erp_orders SET qty = v_qty, price = v_price, status = v_status
    WHERE company_id = p_company_id AND id = p_order_id;
END;
$$;
CREATE FUNCTION public.erp_line_shipped(p_company_id uuid, p_line_id uuid, p_delivered_only boolean DEFAULT false)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce(sum(l.qty), 0) FROM public.erp_shipment_lines l
  JOIN public.erp_shipments s ON s.company_id = l.company_id AND s.id = l.shipment_id
  WHERE l.company_id = p_company_id AND l.line_id = p_line_id AND s.kind = 'order'
    AND (CASE WHEN p_delivered_only THEN s.status = 'delivered' ELSE s.status <> 'cancelled' END);
$$;
CREATE FUNCTION public.erp_ready(p_company_id uuid, p_order_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_order public.erp_orders%ROWTYPE; v_line public.erp_order_items%ROWTYPE; v_item public.erp_items%ROWTYPE;
  v_material numeric; v_labor numeric; v_total numeric; v_before numeric; v_after numeric; v_cost numeric; v_new_labor numeric;
BEGIN
  SELECT * INTO v_order FROM public.erp_orders WHERE company_id = p_company_id AND id = p_order_id FOR UPDATE;
  IF NOT FOUND OR v_order.status <> 'production' THEN RETURN; END IF;
  FOR v_line IN SELECT * FROM public.erp_order_items
    WHERE company_id = p_company_id AND order_id = p_order_id AND status = 'production' ORDER BY position LOOP
    IF EXISTS (SELECT 1 FROM public.erp_tasks WHERE company_id = p_company_id AND line_id = v_line.id AND completed < planned) THEN
      CONTINUE;
    END IF;
    IF EXISTS (SELECT 1 FROM public.erp_order_materials WHERE company_id = p_company_id AND line_id = v_line.id AND issued_qty < qty) THEN
      CONTINUE;
    END IF;
    UPDATE public.erp_order_items SET status = 'ready' WHERE company_id = p_company_id AND id = v_line.id;
    IF v_order.kind = 'series' AND NOT EXISTS (
      SELECT 1 FROM public.erp_stock_movements WHERE company_id = p_company_id AND source = 'production' AND source_id = p_order_id) THEN
      SELECT * INTO STRICT v_item FROM public.erp_items WHERE company_id = p_company_id AND id = v_order.output_item_id;
      SELECT round(coalesce(sum(round(m.issued_qty * m.actual_cost, 2)), 0), 2) INTO v_material
        FROM public.erp_order_materials m WHERE m.company_id = p_company_id AND m.order_id = p_order_id AND m.issued_qty > 0;
      SELECT round(coalesce(sum(p.amount), 0), 2) INTO v_labor
        FROM public.erp_payroll p WHERE p.company_id = p_company_id AND p.order_id = p_order_id AND p.status = 'accepted';
      v_total := round(v_material + v_labor, 2);
      v_before := public.erp_stock_qty(p_company_id, v_item.id);
      v_after := v_before + v_order.qty;
      v_cost := round((v_before * v_item.cost + v_total) / v_after, 2);
      v_new_labor := least(v_cost, round((v_before * v_item.labor_cost + v_labor) / v_after, 2));
      UPDATE public.erp_items SET cost = v_cost, labor_cost = v_new_labor,
        material_cost = round(v_cost - v_new_labor, 2) WHERE company_id = p_company_id AND id = v_item.id;
      INSERT INTO public.erp_stock_movements(company_id, item_id, direction, qty, unit_cost, source, source_id, note)
        VALUES (p_company_id, v_item.id, 'in', v_order.qty, round(v_total / v_order.qty, 2), 'production', p_order_id, '');
    END IF;
  END LOOP;
  PERFORM public.erp_sync_order(p_company_id, p_order_id);
END;
$$;
CREATE FUNCTION public.erp_work_task(p_company_id uuid, p_actor public.erp_profiles, p_order_id uuid, p_task_id uuid)
RETURNS public.erp_tasks LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_order public.erp_orders%ROWTYPE; v_task public.erp_tasks%ROWTYPE; v_operation public.erp_operations%ROWTYPE;
BEGIN
  SELECT * INTO v_order FROM public.erp_orders WHERE company_id = p_company_id AND id = p_order_id FOR UPDATE;
  IF NOT FOUND OR v_order.status <> 'production' THEN
    RAISE EXCEPTION 'Production order required' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO v_task FROM public.erp_tasks WHERE company_id = p_company_id AND id = p_task_id AND order_id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Task not found' USING ERRCODE = '22023'; END IF;
  IF v_task.executor_kind <> 'employee' OR v_task.employee_id IS NULL THEN
    RAISE EXCEPTION 'Outsourced task is not available to workers' USING ERRCODE = '42501';
  END IF;
  IF p_actor.role <> 'admin' AND v_task.employee_id <> p_actor.employee_id THEN
    RAISE EXCEPTION 'Task is not assigned to this worker' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_operation FROM public.erp_operations WHERE company_id = p_company_id AND id = v_task.operation_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Operation not found' USING ERRCODE = '22023'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.erp_employees WHERE company_id = p_company_id AND id = v_task.employee_id AND active) THEN
    RAISE EXCEPTION 'Active employee not found' USING ERRCODE = '22023';
  END IF;
  IF NOT (v_task.employee_id = ANY(v_operation.employee_ids)) THEN
    RAISE EXCEPTION 'Employee is not authorized for this operation' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.erp_order_items i
    WHERE i.company_id = p_company_id AND i.order_id = v_order.id AND i.id = v_task.line_id AND i.status = 'production') THEN
    RAISE EXCEPTION 'Order position is not in production' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM public.erp_order_materials WHERE company_id = p_company_id AND line_id = v_task.line_id AND issued_qty < qty) THEN
    RAISE EXCEPTION 'Issue all materials before work' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM public.erp_tasks WHERE company_id = p_company_id AND line_id = v_task.line_id AND position < v_task.position AND completed < planned) THEN
    RAISE EXCEPTION 'Previous route stages must be accepted first' USING ERRCODE = '23514';
  END IF;
  RETURN v_task;
END;
$$;
CREATE FUNCTION public.erp_assert_cash(p_company_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v record; v_cash numeric; v_bank numeric;
BEGIN
  v_cash := public.erp_balance(p_company_id, 'cash');
  v_bank := public.erp_balance(p_company_id, 'bank');
  IF v_cash < 0 OR v_bank < 0 THEN
    RAISE EXCEPTION 'Insufficient account balance' USING ERRCODE = '23514';
  END IF;
  IF v_cash > 1000000000000 OR v_bank > 1000000000000 OR v_cash + v_bank > 1000000000000 THEN
    RAISE EXCEPTION 'Account balances exceed 1e12 UZS' USING ERRCODE = '23514';
  END IF;
  -- Include liabilities without payments, so accrual alone cannot exceed safe caps.
  FOR v IN
    SELECT 'supplier'::text AS source, id AS source_id, public.erp_supplier_cost(p_company_id, id) AS cap
      FROM public.erp_suppliers WHERE company_id = p_company_id
    UNION ALL
    SELECT 'payroll', e.id, coalesce((SELECT sum(amount) FROM public.erp_payroll p WHERE p.company_id = p_company_id AND p.employee_id = e.id AND p.status = 'accepted'), 0)
      FROM public.erp_employees e WHERE e.company_id = p_company_id
  LOOP
    IF v.cap > 1000000000000 THEN
      RAISE EXCEPTION 'Liability exceeds 1e12 UZS for % %', v.source, v.source_id USING ERRCODE = '23514';
    END IF;
    IF NOT (public.erp_paid(p_company_id, v.source, v.source_id) BETWEEN 0
      AND CASE WHEN v.source = 'supplier'
        OR (v.source = 'payroll' AND (
          EXISTS (SELECT 1 FROM public.erp_salary_plans p WHERE p.company_id = p_company_id AND p.employee_id = v.source_id)
          OR EXISTS (SELECT 1 FROM public.erp_cash c WHERE c.company_id = p_company_id AND c.source = 'payroll'
            AND c.source_id = v.source_id AND c.category IN ('payroll', 'advance'))
        )) THEN 1000000000000 ELSE v.cap END) THEN
      RAISE EXCEPTION 'Invalid net payment for % %', v.source, v.source_id USING ERRCODE = '23514';
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM public.erp_cash c WHERE c.company_id = p_company_id AND (
    (c.source = 'sale' AND NOT EXISTS (SELECT 1 FROM public.erp_customers WHERE company_id = p_company_id AND id = c.customer_id)) OR
    (c.source = 'supplier' AND NOT EXISTS (SELECT 1 FROM public.erp_suppliers WHERE company_id = p_company_id AND id = c.source_id)) OR
    (c.source = 'payroll' AND NOT EXISTS (SELECT 1 FROM public.erp_employees WHERE company_id = p_company_id AND id = c.source_id)))) THEN
    RAISE EXCEPTION 'Cash source entity not found' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM public.erp_orders o WHERE o.company_id = p_company_id AND (
    o.overhead + coalesce((SELECT sum(round(m.qty * m.estimated_cost, 2)) FROM public.erp_order_materials m WHERE m.company_id = o.company_id AND m.order_id = o.id), 0)
      + coalesce((SELECT sum(CASE WHEN t.supplier_cost > 0 THEN round(t.supplier_cost, 2) ELSE round(t.planned * t.rate, 2) END) FROM public.erp_tasks t WHERE t.company_id = o.company_id AND t.order_id = o.id), 0) > 1000000000000
    OR o.overhead + coalesce((SELECT sum(round(m.issued_qty * m.actual_cost, 2)) FROM public.erp_order_materials m WHERE m.company_id = o.company_id AND m.order_id = o.id AND m.issued_qty > 0), 0)
      + coalesce((SELECT sum(p.amount) FROM public.erp_payroll p WHERE p.company_id = o.company_id AND p.order_id = o.id AND p.status = 'accepted'), 0)
      + coalesce((SELECT sum(CASE WHEN t.supplier_cost > 0 THEN round(t.supplier_cost, 2) ELSE round(t.completed * t.rate, 2) END) FROM public.erp_tasks t WHERE t.company_id = o.company_id AND t.order_id = o.id AND t.executor_kind = 'supplier' AND t.status = 'completed'), 0) > 1000000000000))
    OR EXISTS (SELECT 1 FROM public.erp_purchases p WHERE p.company_id = p_company_id AND
      (SELECT coalesce(sum(round(l.qty * l.price, 2)), 0) FROM public.erp_purchase_lines l WHERE l.company_id = p.company_id AND l.purchase_id = p.id) > 1000000000000) THEN
    RAISE EXCEPTION 'Aggregate order or purchase cost exceeds 1e12 UZS' USING ERRCODE = '23514';
  END IF;
END;
$$;
CREATE FUNCTION public.erp_assert_stock(p_company_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.erp_items i
    WHERE i.company_id = p_company_id AND i.cost <> i.material_cost + i.labor_cost) THEN
    RAISE EXCEPTION 'Item cost components do not add up' USING ERRCODE = '23514';
  END IF;
  -- A revised route may raise a production order's unissued need above the shelf (paint bought after the
  -- client grew the area). The domain records that need and the shortage widget reports it, so the sweep
  -- protects the physical quantity only; launch, issue and inventory.count still guard their own step.
  IF EXISTS (SELECT 1 FROM public.erp_items i
    WHERE i.company_id = p_company_id AND public.erp_stock_qty(p_company_id, i.id) < 0) THEN
    RAISE EXCEPTION 'Stock cannot be negative' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM public.erp_items i WHERE i.company_id = p_company_id AND (
    public.erp_stock_qty(p_company_id, i.id) > 1000000000
    OR public.erp_reserved_qty(p_company_id, i.id) > 1000000000
    OR round(public.erp_stock_qty(p_company_id, i.id) * i.cost, 2) > 1000000000000)) THEN
    RAISE EXCEPTION 'Stock exceeds safe quantity or value limits' USING ERRCODE = '23514';
  END IF;
END;
$$;
CREATE FUNCTION public.erp_salary_ledger(p_company uuid, p_employee uuid, p_as_of date DEFAULT (CURRENT_DATE))
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $$
DECLARE
  v_start text;
  v_payments numeric := 0;
  v_deduct numeric := 0;
  v_available numeric := 0;
  v_deactivated date;
  v_month date;
  v_days numeric;
  v_active numeric;
  v_rate numeric;
  v_obliged numeric;
  v_paid numeric;
  v_sum_obliged numeric := 0;
  v_sum_unpaid numeric := 0;
  v_months jsonb := '[]'::jsonb;
BEGIN
  SELECT min(from_month) INTO v_start
    FROM public.erp_salary_plans WHERE company_id = p_company AND employee_id = p_employee;

  IF v_start IS NULL THEN
    RETURN jsonb_build_object('employeeId', p_employee::text, 'months', '[]'::jsonb, 'prepaid', 0,
      'owed', 0, 'paidTotal', 0, 'plannedTotal', 0);
  END IF;

  SELECT round(coalesce(sum(CASE WHEN direction = 'out' THEN amount ELSE -amount END), 0), 2) INTO v_payments
    FROM public.erp_cash
   WHERE company_id = p_company AND source = 'payroll' AND source_id = p_employee AND direction IN ('in', 'out')
     AND created_at >= ((v_start || '-01')::timestamp AT TIME ZONE 'UTC');
  SELECT round(coalesce(sum(CASE WHEN direction = 'deduct' THEN amount ELSE -amount END), 0), 2) INTO v_deduct
    FROM public.erp_worker_deductions
   WHERE company_id = p_company AND employee_id = p_employee
     AND created_at >= ((v_start || '-01')::timestamp AT TIME ZONE 'UTC');
  v_payments := round(v_payments + v_deduct, 2);
  v_available := greatest(0, v_payments);

  SELECT deactivated_at INTO v_deactivated
    FROM public.erp_employees WHERE company_id = p_company AND id = p_employee;

  FOR v_month IN
    SELECT generate_series((v_start || '-01')::date, date_trunc('month', p_as_of)::date, '1 month')::date
  LOOP
    SELECT amount INTO v_rate FROM public.erp_salary_plans
     WHERE company_id = p_company AND employee_id = p_employee AND from_month <= to_char(v_month, 'YYYY-MM')
     ORDER BY from_month DESC, created_at DESC, id DESC LIMIT 1;
    v_rate := coalesce(v_rate, 0);
    v_days := extract(day FROM (v_month + interval '1 month - 1 day')::date);
    IF v_deactivated IS NOT NULL AND to_char(v_deactivated, 'YYYY-MM') <= to_char(v_month, 'YYYY-MM') THEN
      v_active := CASE WHEN to_char(v_deactivated, 'YYYY-MM') = to_char(v_month, 'YYYY-MM')
                       THEN (v_deactivated - date_trunc('month', v_month)::date) + 1 ELSE 0 END;
    ELSE
      v_active := v_days;
    END IF;
    v_obliged := round(CASE WHEN v_active > 0 THEN v_rate * v_active / v_days ELSE 0 END, 2);
    v_paid := least(v_obliged, v_available);
    v_available := round(v_available - v_paid, 2);
    v_sum_obliged := round(v_sum_obliged + v_obliged, 2);
    v_sum_unpaid := round(v_sum_unpaid + (v_obliged - v_paid), 2);
    v_months := v_months || jsonb_build_object('month', to_char(v_month, 'YYYY-MM'), 'obliged', v_obliged,
      'paid', v_paid, 'unpaid', round(v_obliged - v_paid, 2));
  END LOOP;

  RETURN jsonb_build_object('employeeId', p_employee::text, 'months', v_months, 'prepaid', v_available,
    'owed', v_sum_unpaid, 'paidTotal', v_payments, 'plannedTotal', v_sum_obliged);
END;
$$;
CREATE FUNCTION public.erp_expense_ledger(p_company uuid, p_plan uuid, p_as_of date DEFAULT (CURRENT_DATE))
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $$
DECLARE
  v_title text;
  v_start text;
  v_payments numeric := 0;
  v_month date;
  v_rate numeric;
  v_obliged numeric;
  v_paid numeric;
  v_available numeric := 0;
  v_sum_obliged numeric := 0;
  v_sum_unpaid numeric := 0;
  v_months jsonb := '[]'::jsonb;
BEGIN
  SELECT round(coalesce(sum(CASE WHEN direction = 'out' THEN amount ELSE -amount END), 0), 2) INTO v_payments
    FROM public.erp_cash
   WHERE company_id = p_company AND source = 'expense' AND source_id = p_plan AND direction IN ('in', 'out');

  SELECT min(from_month) INTO v_start
    FROM public.erp_expense_plans WHERE company_id = p_company AND plan_id = p_plan;

  IF v_start IS NULL THEN
    RETURN jsonb_build_object('planId', p_plan::text, 'title', '', 'months', '[]'::jsonb,
      'prepaid', greatest(v_payments, 0), 'owed', 0, 'paidTotal', v_payments, 'plannedTotal', 0);
  END IF;

  SELECT title INTO v_title FROM public.erp_expense_plans
   WHERE company_id = p_company AND plan_id = p_plan
   ORDER BY from_month DESC, created_at DESC, id DESC LIMIT 1;

  v_available := v_payments;
  FOR v_month IN
    SELECT generate_series((v_start || '-01')::date, date_trunc('month', p_as_of)::date, '1 month')::date
  LOOP
    SELECT amount INTO v_rate FROM public.erp_expense_plans
     WHERE company_id = p_company AND plan_id = p_plan AND from_month <= to_char(v_month, 'YYYY-MM')
     ORDER BY from_month DESC, created_at DESC, id DESC LIMIT 1;
    v_rate := coalesce(v_rate, 0);
    v_obliged := round(v_rate, 2);
    v_paid := least(v_obliged, greatest(v_available, 0));
    v_available := round(v_available - v_paid, 2);
    v_sum_obliged := round(v_sum_obliged + v_obliged, 2);
    v_sum_unpaid := round(v_sum_unpaid + (v_obliged - v_paid), 2);
    v_months := v_months || jsonb_build_object('month', to_char(v_month, 'YYYY-MM'), 'obliged', v_obliged,
      'paid', v_paid, 'unpaid', round(v_obliged - v_paid, 2));
  END LOOP;
  RETURN jsonb_build_object('planId', p_plan::text, 'title', v_title, 'months', v_months,
    'prepaid', v_available, 'owed', v_sum_unpaid,
    'paidTotal', v_payments, 'plannedTotal', v_sum_obliged);
END;
$$;
CREATE FUNCTION public.erp_loan_ledger(p_company uuid, p_loan uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $$
DECLARE
  v_title text; v_kind text; v_amount numeric := 0; v_drawn numeric; v_repaid numeric;
BEGIN
  SELECT title, kind, amount INTO v_title, v_kind, v_amount
    FROM public.erp_loans WHERE company_id = p_company AND id = p_loan;
  v_title := coalesce(v_title, '');
  v_kind := coalesce(v_kind, 'loan');
  SELECT round(coalesce(sum(CASE direction WHEN 'in' THEN amount ELSE -amount END), 0), 2) INTO v_drawn
    FROM public.erp_cash
   WHERE company_id = p_company AND source = 'loan' AND source_id = p_loan AND category = 'loan-draw' AND direction IN ('in', 'out');
  SELECT round(coalesce(sum(CASE direction WHEN 'out' THEN amount ELSE -amount END), 0), 2) INTO v_repaid
    FROM public.erp_cash
   WHERE company_id = p_company AND source = 'loan' AND source_id = p_loan AND category = 'loan-repay' AND direction IN ('in', 'out');
  RETURN jsonb_build_object('id', p_loan::text, 'title', v_title, 'kind', v_kind, 'principal', v_amount,
    'drawn', v_drawn, 'available', greatest(round(v_amount - v_drawn, 2), 0),
    'repaid', v_repaid, 'owed', greatest(round(v_amount - v_repaid, 2), 0));
END;
$$;
CREATE OR REPLACE FUNCTION public.erp_has_permission(p_profile public.erp_profiles, p_key text)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT p_profile.role = 'admin' OR COALESCE(p_profile.permissions ? p_key, false);
$$;
CREATE OR REPLACE FUNCTION public.erp_command_permission(p_type text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_type
    WHEN 'customer.create' THEN 'orders.create'
    WHEN 'customer.claim' THEN 'customers.claim'
    WHEN 'customer.assign' THEN 'customers.assign'
    WHEN 'customer.pay' THEN 'payments.customer'
    WHEN 'order.create' THEN 'orders.create'
    WHEN 'series.create' THEN 'orders.create'
    WHEN 'order.cancel' THEN 'orders.cancel'
    WHEN 'order.launch' THEN 'orders.launch'
    WHEN 'order.issue' THEN 'orders.issue_materials'
    WHEN 'purchase.create' THEN 'purchases.create'
    WHEN 'purchase.receive' THEN 'purchases.receive'
    WHEN 'supplier.pay' THEN 'suppliers.pay'
    WHEN 'inventory.count' THEN 'warehouse.count'
    WHEN 'warehouse.transfer' THEN 'warehouse.transfer'
    WHEN 'cash.post' THEN 'cash.post'
    WHEN 'cash.reverse' THEN 'cash.reverse'
    WHEN 'payroll.pay' THEN 'salaries.pay'
    WHEN 'salary.plan.set' THEN 'salaries.pay'
    WHEN 'salary.pay' THEN 'salaries.pay'
    WHEN 'shipment.create' THEN 'shipments.create'
    WHEN 'shipment.createStock' THEN 'shipments.create'
    WHEN 'shipment.deliver' THEN 'shipments.deliver'
    WHEN 'work.review' THEN 'work.review'
    WHEN 'machine.create' THEN 'settings.catalog'
    WHEN 'machine.update' THEN 'settings.catalog'
    WHEN 'operation.create' THEN 'settings.catalog'
    WHEN 'operation.update' THEN 'settings.catalog'
    WHEN 'item.create' THEN 'settings.catalog'
    WHEN 'item.update' THEN 'settings.catalog'
    WHEN 'recipe.create' THEN 'settings.catalog'
    WHEN 'recipe.version.create' THEN 'settings.catalog'
    WHEN 'routeTemplate.create' THEN 'settings.catalog'
    WHEN 'routeTemplate.update' THEN 'settings.catalog'
    ELSE NULL
  END;
$$;
CREATE OR REPLACE FUNCTION public.erp_can_touch_order(p_profile public.erp_profiles, p_customer_seller_id uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT p_profile.role = 'admin'
      OR public.erp_has_permission(p_profile, 'orders.edit_all')
      OR (public.erp_has_permission(p_profile, 'orders.edit_own') AND p_customer_seller_id IS NOT NULL AND p_customer_seller_id = p_profile.employee_id);
$$;
CREATE FUNCTION public.erp_snapshot()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_revision bigint; v_profile public.erp_profiles%ROWTYPE; v_company uuid; v_admin boolean; v_board boolean;
  v_has_purchases_view boolean; v_has_cost_view boolean; v_has_cash_view boolean; v_has_salaries_view boolean;
  v_has_orders_view_all boolean; v_has_shipments_view boolean; v_has_payments_customer boolean;
  v_has_work_review boolean; v_has_production_view_all boolean; v_has_defects_view boolean; v_has_reports_view boolean;
BEGIN
  v_profile := public.erp_current_profile();
  v_company := v_profile.company_id;
  -- The shared lock keeps all snapshot arrays at one committed revision.
  SELECT revision INTO STRICT v_revision FROM public.erp_metadata WHERE company_id = v_company FOR SHARE;
  v_admin := v_profile.role = 'admin';
  v_board := v_profile.role = 'display';
  v_has_purchases_view := public.erp_has_permission(v_profile, 'purchases.view');
  v_has_cost_view := public.erp_has_permission(v_profile, 'cost.view');
  v_has_cash_view := public.erp_has_permission(v_profile, 'cash.view');
  v_has_salaries_view := public.erp_has_permission(v_profile, 'salaries.view');
  v_has_orders_view_all := public.erp_has_permission(v_profile, 'orders.view_all');
  v_has_shipments_view := public.erp_has_permission(v_profile, 'shipments.view');
  v_has_payments_customer := public.erp_has_permission(v_profile, 'payments.customer');
  v_has_work_review := public.erp_has_permission(v_profile, 'work.review');
  v_has_production_view_all := public.erp_has_permission(v_profile, 'production.view_all');
  v_has_defects_view := public.erp_has_permission(v_profile, 'defects.view');
  v_has_reports_view := public.erp_has_permission(v_profile, 'reports.view');
  RETURN jsonb_build_object(
    'actor', jsonb_build_object('id', CASE WHEN v_profile.role = 'worker' THEN v_profile.employee_id ELSE v_profile.id END,
      'name', v_profile.name, 'role', v_profile.role, 'companyId', v_company,
      'permissions', v_profile.permissions, 'workshopIds', v_profile.scope_workshop_ids,
      'warehouseIds', v_profile.scope_warehouse_ids),
    'state', jsonb_build_object(
      'version', 4, 'revision', v_revision, 'companyId', v_company,
      'customers', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name,
        'phone', CASE WHEN v_admin OR v_has_orders_view_all THEN c.phone ELSE '' END,
        'address', CASE WHEN v_admin OR v_has_orders_view_all THEN c.address ELSE '' END,
        'kind', c.kind, 'employeeId', c.employee_id, 'sellerId', c.seller_id) ORDER BY c.id), '[]'::jsonb)
        FROM public.erp_customers c WHERE c.company_id = v_company AND (v_admin OR v_board OR v_has_orders_view_all
          OR c.seller_id = v_profile.employee_id
          OR EXISTS (SELECT 1 FROM public.erp_orders o JOIN public.erp_tasks t ON t.company_id = o.company_id AND t.order_id = o.id
            WHERE o.company_id = v_company AND o.customer_id = c.id AND t.employee_id = v_profile.employee_id))),
      'suppliers', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'phone', s.phone) ORDER BY s.id), '[]'::jsonb)
        FROM public.erp_suppliers s WHERE s.company_id = v_company AND (v_admin OR v_has_purchases_view)),
      'employees', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'name', e.name, 'active', e.active, 'deactivatedAt', e.deactivated_at) ORDER BY e.id), '[]'::jsonb)
        FROM public.erp_employees e WHERE e.company_id = v_company AND (v_admin OR v_board OR e.id = v_profile.employee_id)),
      'machines', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'name', m.name,
        'hourlyRevenueTarget', m.hourly_revenue_target, 'active', m.active) ORDER BY m.id), '[]'::jsonb)
        FROM public.erp_machines m WHERE m.company_id = v_company AND v_admin),
      'operations', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', op.id, 'name', op.name, 'unit', op.unit,
        'salePrice', CASE WHEN v_admin THEN op.sale_price ELSE 0 END,
        'workerRate', CASE WHEN v_admin THEN op.worker_rate ELSE 0 END,
        'standardMinutes', op.standard_minutes, 'machineId', op.machine_id,
        'employeeIds', CASE WHEN v_admin THEN to_jsonb(op.employee_ids)
          WHEN v_profile.role = 'worker' AND v_profile.employee_id = ANY(op.employee_ids) THEN to_jsonb(ARRAY[v_profile.employee_id])
          ELSE '[]'::jsonb END,
        'active', op.active, 'autoAccept', op.auto_accept,
        'norms', CASE WHEN v_admin THEN op.norms ELSE '[]'::jsonb END) ORDER BY op.id), '[]'::jsonb)
        FROM public.erp_operations op WHERE op.company_id = v_company AND (v_admin OR v_board
          OR EXISTS (SELECT 1 FROM public.erp_tasks t WHERE t.company_id = op.company_id AND t.operation_id = op.id
            AND EXISTS (SELECT 1 FROM public.erp_tasks own WHERE own.company_id = t.company_id AND own.order_id = t.order_id
              AND own.employee_id = v_profile.employee_id)))),
      'items', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'name', i.name, 'unit', i.unit,
        'minQty', CASE WHEN v_admin THEN i.min_qty ELSE 0 END, 'cost', CASE WHEN v_admin OR v_has_cost_view THEN i.cost ELSE 0 END,
        'customerId', i.customer_id, 'kind', i.kind,
        'salePrice', CASE WHEN v_admin OR v_has_cost_view THEN i.sale_price ELSE 0 END,
        'lastPurchasePrice', CASE WHEN v_admin OR v_has_cost_view THEN i.last_purchase_price ELSE 0 END,
        'materialCost', CASE WHEN v_admin OR v_has_cost_view THEN i.material_cost ELSE 0 END,
        'laborCost', CASE WHEN v_admin OR v_has_cost_view THEN i.labor_cost ELSE 0 END,
        'category', i.category, 'photo', i.photo) ORDER BY i.id), '[]'::jsonb)
        FROM public.erp_items i WHERE i.company_id = v_company AND (v_admin
          OR EXISTS (SELECT 1 FROM public.erp_order_materials m JOIN public.erp_tasks t ON t.company_id = m.company_id AND t.order_id = m.order_id
            WHERE m.company_id = v_company AND m.item_id = i.id AND t.employee_id = v_profile.employee_id))),
      'recipes', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name, 'outputItemId', r.output_item_id,
        'active', r.active, 'versions', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', v.id, 'version', v.version,
          'createdAt', v.created_at, 'components', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'slot', c.slot,
            'itemId', c.item_id, 'allowedItemIds', to_jsonb(c.allowed_item_ids), 'qtyPerUnit', c.qty_per_unit) ORDER BY c.position), '[]'::jsonb)
            FROM public.erp_recipe_components c WHERE c.company_id = v.company_id AND c.version_id = v.id)
          ) ORDER BY v.version), '[]'::jsonb)
          FROM public.erp_recipe_versions v WHERE v.company_id = r.company_id AND v.recipe_id = r.id)
        ) ORDER BY r.id), '[]'::jsonb)
        FROM public.erp_recipes r WHERE r.company_id = v_company AND v_admin),
      'orders', (SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', o.id, 'number', o.number, 'kind', o.kind, 'customerId', coalesce(o.customer_id::text, ''), 'title', o.title,
        'outputItemId', CASE WHEN v_admin THEN o.output_item_id ELSE NULL END,
        'recipeVersionId', CASE WHEN v_admin THEN o.recipe_version_id ELSE NULL END,
        'substitutions', CASE WHEN v_admin THEN o.substitutions ELSE '{}'::jsonb END,
        'qty', o.qty, 'price', CASE WHEN v_admin OR v_has_cost_view THEN o.price ELSE 0 END, 'overhead', CASE WHEN v_admin OR v_has_cost_view THEN o.overhead ELSE 0 END,
        'markup', CASE WHEN v_admin OR v_has_cost_view THEN o.markup ELSE 0 END,
        'dueDate', o.due_date, 'createdAt', o.created_at, 'status', o.status,
        'lines', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'kind', i.kind, 'title', i.title,
          'qty', i.qty, 'total', CASE WHEN v_admin THEN i.total ELSE 0 END, 'status', i.status) ORDER BY i.position), '[]'::jsonb)
          FROM public.erp_order_items i WHERE i.company_id = o.company_id AND i.order_id = o.id),
        'materials', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'lineId', m.line_id, 'itemId', m.item_id, 'qty', m.qty,
          'issuedQty', m.issued_qty,
          'estimatedCost', CASE WHEN v_admin OR v_has_cost_view THEN m.estimated_cost ELSE 0 END, 'issued', m.issued_qty >= m.qty,
          'actualCost', CASE WHEN v_admin OR v_has_cost_view THEN m.actual_cost ELSE 0 END) ORDER BY m.position, m.id), '[]'::jsonb)
          FROM public.erp_order_materials m WHERE m.company_id = o.company_id AND m.order_id = o.id),
        'route', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'lineId', t.line_id, 'operationId', t.operation_id, 'name', t.name,
          'executorKind', t.executor_kind,
          'employeeId', CASE WHEN v_admin OR v_board OR t.employee_id = v_profile.employee_id THEN t.employee_id::text ELSE '' END,
          'supplierId', CASE WHEN v_admin THEN t.supplier_id::text ELSE NULL END,
          'rate', CASE WHEN v_admin OR v_has_cost_view OR t.employee_id = v_profile.employee_id THEN t.rate ELSE 0 END,
          'supplierCost', CASE WHEN v_admin OR v_has_cost_view THEN t.supplier_cost ELSE 0 END,
          'salePrice', CASE WHEN v_admin OR v_has_cost_view THEN t.sale_price ELSE 0 END,
          'standardMinutes', t.standard_minutes,
          'planned', t.planned, 'completed', t.completed, 'status', t.status) ORDER BY t.position, t.id), '[]'::jsonb)
          FROM public.erp_tasks t WHERE t.company_id = o.company_id AND t.order_id = o.id
            AND (v_admin OR v_board OR t.executor_kind = 'employee'))
        ) ORDER BY o.created_at, o.id), '[]'::jsonb) FROM public.erp_orders o
        WHERE o.company_id = v_company AND (v_admin OR v_board OR v_has_orders_view_all
          OR EXISTS (SELECT 1 FROM public.erp_customers oc WHERE oc.company_id = o.company_id AND oc.id = o.customer_id AND oc.seller_id = v_profile.employee_id)
          OR EXISTS (SELECT 1 FROM public.erp_tasks t WHERE t.company_id = o.company_id AND t.order_id = o.id AND t.employee_id = v_profile.employee_id))),
      'purchases', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'number', p.number, 'supplierId', p.supplier_id, 'createdAt', p.created_at,
        'lines', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'itemId', l.item_id, 'qty', l.qty, 'price', l.price, 'received', l.received,
          'previousPurchasePrice', l.previous_purchase_price, 'newPurchasePrice', l.new_purchase_price,
          'previousAverageCost', l.previous_average_cost, 'newAverageCost', l.new_average_cost) ORDER BY l.position), '[]'::jsonb)
          FROM public.erp_purchase_lines l WHERE l.company_id = p.company_id AND l.purchase_id = p.id)
        ) ORDER BY p.created_at, p.id), '[]'::jsonb) FROM public.erp_purchases p WHERE p.company_id = v_company AND (v_admin OR v_has_purchases_view)),
      'movements', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'itemId', m.item_id, 'direction', m.direction, 'qty', m.qty,
        'unitCost', CASE WHEN v_admin OR v_has_cost_view THEN m.unit_cost ELSE 0 END,
        'source', m.source, 'sourceId', m.source_id,
        'note', CASE WHEN v_admin THEN m.note ELSE '' END, 'createdAt', m.created_at) ORDER BY m.created_at, m.id), '[]'::jsonb)
        FROM public.erp_stock_movements m WHERE m.company_id = v_company AND NOT v_board),
      'cash', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'direction', c.direction, 'amount', c.amount, 'account', c.account,
        'toAccount', c.to_account, 'source', c.source, 'sourceId', c.source_id, 'customerId', c.customer_id, 'category', c.category,
        'note', CASE WHEN v_admin THEN c.note ELSE '' END, 'number', c.number, 'reversalOf', c.reversal_of, 'createdAt', c.created_at) ORDER BY c.created_at, c.id), '[]'::jsonb)
        FROM public.erp_cash c WHERE c.company_id = v_company AND (v_admin OR v_has_cash_view
          OR (c.source = 'sale' AND c.customer_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM public.erp_customers cc WHERE cc.company_id = c.company_id AND cc.id = c.customer_id AND (
              v_has_orders_view_all OR cc.seller_id = v_profile.employee_id
              OR EXISTS (SELECT 1 FROM public.erp_orders o2 JOIN public.erp_tasks t2 ON t2.company_id = o2.company_id AND t2.order_id = o2.id
                WHERE o2.company_id = cc.company_id AND o2.customer_id = cc.id AND t2.employee_id = v_profile.employee_id)))))),
      'reports', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'orderId', r.order_id, 'taskId', r.task_id, 'employeeId', r.employee_id,
        'qty', r.qty, 'status', r.status, 'note', r.note, 'createdAt', r.created_at) ORDER BY r.created_at, r.id), '[]'::jsonb)
        FROM public.erp_work_reports r WHERE r.company_id = v_company AND (v_admin OR v_board OR r.employee_id = v_profile.employee_id
          OR v_has_work_review OR v_has_production_view_all)),
      'payroll', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'employeeId', p.employee_id, 'reportId', p.report_id, 'orderId', p.order_id,
        'taskId', p.task_id, 'amount', p.amount, 'status', p.status, 'createdAt', p.created_at) ORDER BY p.created_at, p.id), '[]'::jsonb)
        FROM public.erp_payroll p WHERE p.company_id = v_company AND (v_admin OR v_has_salaries_view OR p.employee_id = v_profile.employee_id)),
      'defects', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'reportId', d.report_id, 'orderId', d.order_id,
        'lineId', d.line_id, 'taskId', d.task_id, 'employeeId', d.employee_id, 'operationId', d.operation_id,
        'qty', d.qty, 'reason', d.reason, 'note', d.note, 'materials', d.materials, 'createdAt', d.created_at)
        ORDER BY d.created_at, d.id), '[]'::jsonb)
        FROM public.erp_defects d WHERE d.company_id = v_company AND (v_admin OR v_has_defects_view OR d.employee_id = v_profile.employee_id)),
      'salaryPlans', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'employeeId', p.employee_id, 'amount', p.amount,
        'mode', p.mode, 'fromMonth', p.from_month, 'createdAt', p.created_at) ORDER BY p.from_month, p.created_at, p.id), '[]'::jsonb)
        FROM public.erp_salary_plans p WHERE p.company_id = v_company AND (v_admin OR v_has_salaries_view)),
      'expensePlans', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'planId', p.plan_id, 'title', p.title,
        'amount', p.amount, 'fromMonth', p.from_month, 'dueDay', p.due_day, 'supplierId', p.supplier_id,
        'createdAt', p.created_at) ORDER BY p.from_month, p.created_at, p.id), '[]'::jsonb)
        FROM public.erp_expense_plans p WHERE p.company_id = v_company AND (v_admin OR v_has_salaries_view)),
      'loans', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'title', l.title, 'kind', l.kind,
        'amount', l.amount, 'note', l.note, 'createdAt', l.created_at) ORDER BY l.created_at, l.id), '[]'::jsonb)
        FROM public.erp_loans l WHERE l.company_id = v_company AND (v_admin OR v_has_reports_view)),
      'routeTemplates', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'kind', t.kind,
        'active', t.active, 'stages', t.stages) ORDER BY t.created_at, t.id), '[]'::jsonb)
        FROM public.erp_route_templates t WHERE t.company_id = v_company AND v_admin),
      'tickets', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'authorId', t.author_id, 'authorName', t.author_name,
        'authorRole', t.author_role, 'status', t.status, 'createdAt', t.created_at, 'updatedAt', t.updated_at,
        'closedAt', t.closed_at, 'closedByName', t.closed_by_name, 'messages', t.messages) ORDER BY t.updated_at, t.id), '[]'::jsonb)
        FROM public.erp_support_tickets t WHERE t.company_id = v_company AND (v_admin OR t.author_id = v_profile.employee_id)),
      'workerDeductions', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'employeeId', d.employee_id,
        'customerId', d.customer_id, 'amount', d.amount, 'direction', d.direction,
        'note', d.note, 'reversalOf', d.reversal_of, 'createdAt', d.created_at) ORDER BY d.created_at, d.id), '[]'::jsonb)
        FROM public.erp_worker_deductions d WHERE d.company_id = v_company AND (v_admin OR EXISTS (
          SELECT 1 FROM public.erp_customers cc WHERE cc.company_id = d.company_id AND cc.id = d.customer_id AND (
            v_has_orders_view_all OR cc.seller_id = v_profile.employee_id
            OR EXISTS (SELECT 1 FROM public.erp_orders o2 JOIN public.erp_tasks t2 ON t2.company_id = o2.company_id AND t2.order_id = o2.id
              WHERE o2.company_id = cc.company_id AND o2.customer_id = cc.id AND t2.employee_id = v_profile.employee_id))))),
      'shipments', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'orderId', s.order_id, 'customerId', s.customer_id,
        'kind', s.kind, 'address', s.address, 'dueDate', s.due_date, 'status', s.status, 'createdAt', s.created_at,
        'deliveredAt', s.delivered_at, 'reversalOf', NULL,
        'lines', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'lineId', l.line_id, 'itemId', l.item_id, 'description', l.description,
          'qty', l.qty, 'salePrice', CASE WHEN v_admin OR v_has_cost_view THEN l.sale_price ELSE 0 END,
          'unitCost', CASE WHEN v_admin OR v_has_cost_view THEN l.unit_cost ELSE 0 END,
          'materialCost', CASE WHEN v_admin OR v_has_cost_view THEN l.material_cost ELSE 0 END,
          'laborCost', CASE WHEN v_admin OR v_has_cost_view THEN l.labor_cost ELSE 0 END) ORDER BY l.position, l.id), '[]'::jsonb)
          FROM public.erp_shipment_lines l WHERE l.company_id = s.company_id AND l.shipment_id = s.id)
        ) ORDER BY s.created_at, s.id), '[]'::jsonb)
        FROM public.erp_shipments s WHERE s.company_id = v_company AND (v_admin OR v_has_shipments_view)),
      'audit', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'actorId', a.actor_id, 'actorName', a.actor_name,
        'action', a.action, 'entityId', a.entity_id, 'createdAt', a.created_at) ORDER BY a.revision, a.id), '[]'::jsonb)
        FROM public.erp_audit a WHERE a.company_id = v_company AND v_admin)
    )
  );
END;
$$;

CREATE FUNCTION public.erp_bootstrap_company(p_name text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_uid uuid := auth.uid(); v_name text; v_actor_name text; v_company uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501'; END IF;
  IF EXISTS (SELECT 1 FROM public.erp_profiles WHERE id = v_uid) THEN
    RAISE EXCEPTION 'Account already belongs to a company' USING ERRCODE = '22023';
  END IF;
  v_name := btrim(coalesce(p_name, ''));
  IF length(v_name) < 2 OR length(v_name) > 160 THEN
    RAISE EXCEPTION 'Company name must be 2 to 160 characters' USING ERRCODE = '22023';
  END IF;
  SELECT coalesce(nullif(btrim(raw_user_meta_data ->> 'name'), ''), nullif(btrim(email), ''), 'Administrator')
    INTO v_actor_name FROM auth.users WHERE id = v_uid;
  IF NOT FOUND THEN RAISE EXCEPTION 'Authentication user not found' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.erp_companies(name) VALUES (v_name) RETURNING id INTO v_company;
  INSERT INTO public.erp_metadata(company_id, revision) VALUES (v_company, 1);
  INSERT INTO public.erp_profiles(id, company_id, name, role, employee_id) VALUES (v_uid, v_company, v_actor_name, 'admin', NULL);
  INSERT INTO public.erp_audit(company_id, request_id, actor_user_id, actor_id, actor_name, action, entity_id, command, revision)
    VALUES (v_company, gen_random_uuid(), v_uid, v_uid, v_actor_name, 'company.bootstrap', v_company::text,
      jsonb_build_object('type', 'company.bootstrap', 'name', v_name), 1);
  RETURN v_company;
END;
$$;

CREATE FUNCTION public.erp_link_worker(p_user_id uuid, p_employee_id uuid)
RETURNS public.erp_profiles LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_revision bigint; v_actor public.erp_profiles%ROWTYPE; v_profile public.erp_profiles%ROWTYPE; v_employee public.erp_employees%ROWTYPE;
BEGIN
  v_actor := public.erp_current_profile();
  IF v_actor.role <> 'admin' THEN RAISE EXCEPTION 'Administrator required' USING ERRCODE = '42501'; END IF;
  SELECT revision INTO STRICT v_revision FROM public.erp_metadata WHERE company_id = v_actor.company_id FOR UPDATE;
  IF p_user_id IS NULL OR p_employee_id IS NULL OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'Valid authentication user and employee UUIDs required' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_employee FROM public.erp_employees WHERE company_id = v_actor.company_id AND id = p_employee_id AND active;
  IF NOT FOUND THEN RAISE EXCEPTION 'Active employee not found' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_profile FROM public.erp_profiles WHERE id = p_user_id;
  IF FOUND THEN
    IF v_profile.company_id <> v_actor.company_id OR v_profile.role <> 'worker' OR v_profile.employee_id <> p_employee_id THEN
      RAISE EXCEPTION 'Existing profile cannot be reassigned or demoted' USING ERRCODE = '42501';
    END IF;
    RETURN v_profile;
  END IF;
  INSERT INTO public.erp_profiles(id, company_id, name, role, employee_id)
    VALUES (p_user_id, v_actor.company_id, v_employee.name, 'worker', p_employee_id) RETURNING * INTO v_profile;
  UPDATE public.erp_metadata SET revision = revision + 1 WHERE company_id = v_actor.company_id;
  INSERT INTO public.erp_audit(company_id, request_id, actor_user_id, actor_id, actor_name, action, entity_id, command, revision)
    VALUES (v_actor.company_id, gen_random_uuid(), v_actor.id, v_actor.id, v_actor.name, 'worker.link', p_employee_id::text,
      jsonb_build_object('type', 'worker.link', 'userId', p_user_id, 'employeeId', p_employee_id), v_revision + 1);
  RETURN v_profile;
END;
$$;

CREATE FUNCTION public.erp_link_display(p_user_id uuid, p_name text)
RETURNS public.erp_profiles LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_revision bigint; v_actor public.erp_profiles%ROWTYPE; v_profile public.erp_profiles%ROWTYPE; v_label text;
BEGIN
  v_actor := public.erp_current_profile();
  IF v_actor.role <> 'admin' THEN RAISE EXCEPTION 'Administrator required' USING ERRCODE = '42501'; END IF;
  SELECT revision INTO STRICT v_revision FROM public.erp_metadata WHERE company_id = v_actor.company_id FOR UPDATE;
  IF p_user_id IS NULL OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'Valid authentication user UUID required' USING ERRCODE = '22023';
  END IF;
  v_label := coalesce(nullif(btrim(p_name), ''), 'Экран цеха');
  IF length(v_label) > 120 THEN RAISE EXCEPTION 'Display name is too long' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_profile FROM public.erp_profiles WHERE id = p_user_id;
  IF FOUND THEN
    IF v_profile.company_id <> v_actor.company_id OR v_profile.role <> 'display' THEN
      RAISE EXCEPTION 'Existing profile cannot be reassigned or demoted' USING ERRCODE = '42501';
    END IF;
    RETURN v_profile;
  END IF;
  INSERT INTO public.erp_profiles(id, company_id, name, role, employee_id)
    VALUES (p_user_id, v_actor.company_id, v_label, 'display', NULL) RETURNING * INTO v_profile;
  UPDATE public.erp_metadata SET revision = revision + 1 WHERE company_id = v_actor.company_id;
  INSERT INTO public.erp_audit(company_id, request_id, actor_user_id, actor_id, actor_name, action, entity_id, command, revision)
    VALUES (v_actor.company_id, gen_random_uuid(), v_actor.id, v_actor.id, v_actor.name, 'display.link', p_user_id::text,
      jsonb_build_object('type', 'display.link', 'userId', p_user_id), v_revision + 1);
  RETURN v_profile;
END;
$$;
CREATE FUNCTION public.erp_execute(p_request_id uuid, p_expected_revision bigint, p_command jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_revision bigint;
  v_actor public.erp_profiles%ROWTYPE;
  v_company uuid;
  v_prior public.erp_audit%ROWTYPE;
  v_type text;
  v_entity uuid;
  v_id uuid;
  v_ref uuid;
  v_customer uuid;
  v_customer_row public.erp_customers%ROWTYPE;
  v_input jsonb;
  v_line jsonb;
  v_pos integer;
  v_qty numeric;
  v_amount numeric;
  v_markup numeric;
  v_cost numeric;
  v_stock numeric;
  v_cap numeric;
  v_advance numeric;
  v_account text;
  v_to_account text;
  v_direction text;
  v_accept boolean;
  v_new_completed numeric;
  v_defect numeric;
  v_good numeric;
  v_reason text;
  v_unit text;
  v_kind text;
  v_category text;
  v_photo text;
  v_sale numeric;
  v_labor numeric;
  v_new_labor numeric;
  v_before numeric;
  v_total numeric;
  v_material_total numeric;
  v_labor_total numeric;
  v_cost_total numeric;
  v_sale_slice numeric;
  v_cost_slice numeric;
  v_material_slice numeric;
  v_version integer;
  v_output uuid;
  v_recipe public.erp_recipes%ROWTYPE;
  v_recipe_version public.erp_recipe_versions%ROWTYPE;
  v_component public.erp_recipe_components%ROWTYPE;
  v_subs jsonb;
  v_slot text;
  v_chosen uuid;
  v_employee_ids uuid[] := ARRAY[]::uuid[];
  v_order public.erp_orders%ROWTYPE;
  v_item public.erp_items%ROWTYPE;
  v_employee public.erp_employees%ROWTYPE;
  v_machine public.erp_machines%ROWTYPE;
  v_operation public.erp_operations%ROWTYPE;
  v_task public.erp_tasks%ROWTYPE;
  v_material public.erp_order_materials%ROWTYPE;
  v_purchase public.erp_purchases%ROWTYPE;
  v_purchase_line public.erp_purchase_lines%ROWTYPE;
  v_report public.erp_work_reports%ROWTYPE;
  v_payroll public.erp_payroll%ROWTYPE;
  v_cash public.erp_cash%ROWTYPE;
  v_shipment public.erp_shipments%ROWTYPE;
  v_lines jsonb;
  v_line_row public.erp_order_items%ROWTYPE;
  v_line_status text;
  v_old_tasks jsonb;
  v_new_tasks jsonb;
  v_title text;
  v_line_kind text;
  v_line_id uuid;
  v_rec record;
  v_pos_material integer;
  v_pos_task integer;
  v_ship_qty numeric;
  v_allow_debt boolean;
  v_note text;
  v_allow_prepay boolean;
  v_owed numeric;
  v_active boolean;
  v_stages jsonb;
  v_employee_id uuid;
  v_ticket public.erp_support_tickets%ROWTYPE;
  v_context jsonb;
  v_author uuid;
  v_text text;
  v_shipped numeric := 0;
  v_paid_by_cash numeric := 0;
  v_paid_by_deduct numeric := 0;
  v_customer_seller_id uuid;
BEGIN
  v_actor := public.erp_current_profile();
  v_company := v_actor.company_id;
  -- Serialize first: retries, stock reservations and money share one authority.
  SELECT revision INTO STRICT v_revision FROM public.erp_metadata WHERE company_id = v_company FOR UPDATE;
  IF p_request_id IS NULL OR p_expected_revision IS NULL OR p_expected_revision < 0 OR p_expected_revision > 9007199254740991 THEN
    RAISE EXCEPTION 'Invalid request envelope' USING ERRCODE = '22023';
  END IF;
  IF p_command IS NULL OR jsonb_typeof(p_command) <> 'object' THEN
    RAISE EXCEPTION 'Command must be an object' USING ERRCODE = '22023';
  END IF;
  v_type := public.erp_text(p_command -> 'type', 'type');
  IF v_actor.role = 'display' THEN
    RAISE EXCEPTION 'Workshop display accounts are read-only' USING ERRCODE = '42501';
  END IF;
  IF v_actor.role = 'worker' THEN
    IF v_type IN ('work.accept', 'work.start', 'work.submit', 'ticket.create', 'ticket.reply') THEN
      NULL; -- base actions: any worker may act on their own stages / tickets
    ELSIF v_type IN ('order.update', 'orderLine.cancel', 'order.cancel', 'order.launch') THEN
      SELECT cc.seller_id INTO v_customer_seller_id FROM public.erp_orders oo
        JOIN public.erp_customers cc ON cc.company_id = oo.company_id AND cc.id = oo.customer_id
        WHERE oo.company_id = v_company AND oo.id = public.erp_uuid(p_command -> 'orderId', 'orderId');
      IF NOT FOUND THEN RAISE EXCEPTION 'Order not found' USING ERRCODE = '22023'; END IF;
      IF NOT public.erp_can_touch_order(v_actor, v_customer_seller_id) THEN
        RAISE EXCEPTION 'You may only manage orders of your own customers' USING ERRCODE = '42501';
      END IF;
      IF v_type = 'order.cancel' AND NOT public.erp_has_permission(v_actor, 'orders.cancel') THEN
        RAISE EXCEPTION 'Administrator action required' USING ERRCODE = '42501';
      END IF;
      IF v_type = 'order.launch' AND NOT public.erp_has_permission(v_actor, 'orders.launch') THEN
        RAISE EXCEPTION 'Administrator action required' USING ERRCODE = '42501';
      END IF;
    ELSE
      IF NOT public.erp_has_permission(v_actor, public.erp_command_permission(v_type)) THEN
        RAISE EXCEPTION 'Administrator action required' USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;
  SELECT * INTO v_prior FROM public.erp_audit WHERE company_id = v_company AND request_id = p_request_id;
  IF FOUND THEN
    IF v_prior.actor_user_id <> v_actor.id THEN
      RAISE EXCEPTION 'Request belongs to another account' USING ERRCODE = '42501';
    END IF;
    IF v_prior.command <> p_command OR v_prior.expected_revision <> p_expected_revision THEN
      RAISE EXCEPTION 'Request UUID reused with a different envelope' USING ERRCODE = '22023';
    END IF;
    RETURN public.erp_snapshot();
  END IF;
  IF v_revision <> p_expected_revision THEN
    RAISE EXCEPTION 'Revision conflict: expected %, current %', p_expected_revision, v_revision USING ERRCODE = '40001';
  END IF;
  IF v_revision = 9007199254740991 THEN RAISE EXCEPTION 'Revision exhausted' USING ERRCODE = '22003'; END IF;

  CASE v_type
    WHEN 'customer.create' THEN
      v_kind := coalesce(p_command ->> 'kind', 'customer');
      IF v_kind NOT IN ('customer', 'shop', 'service') THEN RAISE EXCEPTION 'Invalid customer kind' USING ERRCODE = '22023'; END IF;
      IF p_command ? 'employeeId' AND btrim(p_command ->> 'employeeId') <> '' THEN
        v_employee_id := public.erp_uuid(p_command -> 'employeeId', 'employeeId');
        IF NOT EXISTS (SELECT 1 FROM public.erp_employees WHERE company_id = v_company AND id = v_employee_id) THEN
          RAISE EXCEPTION 'Employee not found' USING ERRCODE = '22023';
        END IF;
        IF EXISTS (SELECT 1 FROM public.erp_customers WHERE company_id = v_company AND employee_id = v_employee_id) THEN
          RAISE EXCEPTION 'Employee already has a customer account' USING ERRCODE = '22023';
        END IF;
      ELSE
        v_employee_id := NULL;
      END IF;
      INSERT INTO public.erp_customers(company_id, name, phone, address, kind, employee_id, seller_id) VALUES (v_company,
        btrim(public.erp_text(p_command -> 'name', 'name')), public.erp_text(p_command -> 'phone', 'phone', true),
        public.erp_text(p_command -> 'address', 'address', true), v_kind, v_employee_id,
        CASE WHEN v_actor.role = 'worker' AND public.erp_has_permission(v_actor, 'customers.claim') THEN v_actor.employee_id ELSE NULL END)
        RETURNING id INTO v_entity;
    WHEN 'customer.claim' THEN
      v_entity := public.erp_uuid(p_command -> 'customerId', 'customerId');
      SELECT * INTO v_customer_row FROM public.erp_customers WHERE company_id = v_company AND id = v_entity;
      IF NOT FOUND THEN RAISE EXCEPTION 'Customer not found' USING ERRCODE = '22023'; END IF;
      IF v_customer_row.seller_id IS NOT NULL THEN RAISE EXCEPTION 'Customer already assigned' USING ERRCODE = '22023'; END IF;
      UPDATE public.erp_customers SET seller_id = v_actor.employee_id WHERE company_id = v_company AND id = v_entity;
    WHEN 'customer.assign' THEN
      v_entity := public.erp_uuid(p_command -> 'customerId', 'customerId');
      SELECT * INTO v_customer_row FROM public.erp_customers WHERE company_id = v_company AND id = v_entity;
      IF NOT FOUND THEN RAISE EXCEPTION 'Customer not found' USING ERRCODE = '22023'; END IF;
      IF p_command ? 'sellerId' AND p_command -> 'sellerId' <> 'null'::jsonb AND btrim(p_command ->> 'sellerId') <> '' THEN
        v_ref := public.erp_uuid(p_command -> 'sellerId', 'sellerId');
        IF NOT EXISTS (SELECT 1 FROM public.erp_employees WHERE company_id = v_company AND id = v_ref AND active) THEN
          RAISE EXCEPTION 'Active employee not found' USING ERRCODE = '22023';
        END IF;
      ELSE
        v_ref := NULL;
      END IF;
      UPDATE public.erp_customers SET seller_id = v_ref WHERE company_id = v_company AND id = v_entity;
    WHEN 'supplier.create' THEN
      INSERT INTO public.erp_suppliers(company_id, name, phone) VALUES (v_company,
        btrim(public.erp_text(p_command -> 'name', 'name')), public.erp_text(p_command -> 'phone', 'phone', true)) RETURNING id INTO v_entity;
    WHEN 'employee.create' THEN
      INSERT INTO public.erp_employees(company_id, name) VALUES (v_company,
        btrim(public.erp_text(p_command -> 'name', 'name'))) RETURNING id INTO v_entity;
    WHEN 'employee.update' THEN
      v_entity := public.erp_uuid(p_command -> 'employeeId', 'employeeId');
      IF NOT EXISTS (SELECT 1 FROM public.erp_employees WHERE company_id = v_company AND id = v_entity) THEN
        RAISE EXCEPTION 'Employee not found' USING ERRCODE = '22023';
      END IF;
      v_active := public.erp_bool(p_command -> 'active', 'active');
      IF p_command ? 'deactivatedAt' AND btrim(p_command ->> 'deactivatedAt') <> ''
         AND (p_command ->> 'deactivatedAt') !~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$' THEN
        RAISE EXCEPTION 'Invalid deactivation date' USING ERRCODE = '22023';
      END IF;
      UPDATE public.erp_employees SET name = btrim(public.erp_text(p_command -> 'name', 'name')), active = v_active,
        deactivated_at = CASE WHEN v_active THEN NULL
          ELSE coalesce(NULLIF(btrim(coalesce(p_command ->> 'deactivatedAt', '')), '')::date, deactivated_at,
            (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date) END
        WHERE company_id = v_company AND id = v_entity;
    WHEN 'machine.create' THEN
      INSERT INTO public.erp_machines(company_id, name, hourly_revenue_target) VALUES (v_company,
        btrim(public.erp_text(p_command -> 'name', 'name')),
        public.erp_money(p_command -> 'hourlyRevenueTarget', 'hourlyRevenueTarget', true)) RETURNING id INTO v_entity;
    WHEN 'machine.update' THEN
      v_entity := public.erp_uuid(p_command -> 'machineId', 'machineId');
      SELECT * INTO v_machine FROM public.erp_machines WHERE company_id = v_company AND id = v_entity;
      IF NOT FOUND THEN RAISE EXCEPTION 'Machine not found' USING ERRCODE = '22023'; END IF;
      UPDATE public.erp_machines SET name = btrim(public.erp_text(p_command -> 'name', 'name')),
        hourly_revenue_target = public.erp_money(p_command -> 'hourlyRevenueTarget', 'hourlyRevenueTarget', true),
        active = public.erp_bool(p_command -> 'active', 'active') WHERE id = v_entity;
    WHEN 'operation.create' THEN
      v_unit := public.erp_unit(p_command -> 'unit');
      IF NOT (p_command ? 'machineId') THEN RAISE EXCEPTION 'machineId is required (UUID or null)' USING ERRCODE = '22023'; END IF;
      v_ref := CASE WHEN p_command -> 'machineId' = 'null'::jsonb THEN NULL ELSE public.erp_uuid(p_command -> 'machineId', 'machineId') END;
      IF v_ref IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.erp_machines WHERE company_id = v_company AND id = v_ref AND active) THEN
        RAISE EXCEPTION 'Active machine not found' USING ERRCODE = '22023';
      END IF;
      FOR v_line IN SELECT value FROM jsonb_array_elements(public.erp_array(p_command -> 'employeeIds', 'employeeIds')) LOOP
        v_id := public.erp_uuid(v_line, 'employeeId');
        IF v_id = ANY(v_employee_ids) THEN RAISE EXCEPTION 'Duplicate employee' USING ERRCODE = '22023'; END IF;
        IF NOT EXISTS (SELECT 1 FROM public.erp_employees WHERE company_id = v_company AND id = v_id AND active) THEN
          RAISE EXCEPTION 'Active employee not found' USING ERRCODE = '22023';
        END IF;
        v_employee_ids := v_employee_ids || v_id;
      END LOOP;
      INSERT INTO public.erp_operations(company_id, name, unit, sale_price, worker_rate, standard_minutes, machine_id, employee_ids, active, auto_accept, norms)
        VALUES (v_company, btrim(public.erp_text(p_command -> 'name', 'name')), v_unit,
          public.erp_money(p_command -> 'salePrice', 'salePrice', true),
          public.erp_money(p_command -> 'workerRate', 'workerRate', true),
          public.erp_num(p_command -> 'standardMinutes', 'standardMinutes', true),
          v_ref, v_employee_ids, public.erp_bool(p_command -> 'active', 'active'),
          public.erp_bool(p_command -> 'autoAccept', 'autoAccept'),
          public.erp_norms(v_company, p_command -> 'norms')) RETURNING id INTO v_entity;
    WHEN 'operation.update' THEN
      v_entity := public.erp_uuid(p_command -> 'operationId', 'operationId');
      IF NOT EXISTS (SELECT 1 FROM public.erp_operations WHERE company_id = v_company AND id = v_entity) THEN
        RAISE EXCEPTION 'Operation not found' USING ERRCODE = '22023';
      END IF;
      v_unit := public.erp_unit(p_command -> 'unit');
      IF NOT (p_command ? 'machineId') THEN RAISE EXCEPTION 'machineId is required (UUID or null)' USING ERRCODE = '22023'; END IF;
      v_ref := CASE WHEN p_command -> 'machineId' = 'null'::jsonb THEN NULL ELSE public.erp_uuid(p_command -> 'machineId', 'machineId') END;
      IF v_ref IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.erp_machines WHERE company_id = v_company AND id = v_ref AND active) THEN
        RAISE EXCEPTION 'Active machine not found' USING ERRCODE = '22023';
      END IF;
      FOR v_line IN SELECT value FROM jsonb_array_elements(public.erp_array(p_command -> 'employeeIds', 'employeeIds')) LOOP
        v_id := public.erp_uuid(v_line, 'employeeId');
        IF v_id = ANY(v_employee_ids) THEN RAISE EXCEPTION 'Duplicate employee' USING ERRCODE = '22023'; END IF;
        IF NOT EXISTS (SELECT 1 FROM public.erp_employees WHERE company_id = v_company AND id = v_id AND active) THEN
          RAISE EXCEPTION 'Active employee not found' USING ERRCODE = '22023';
        END IF;
        v_employee_ids := v_employee_ids || v_id;
      END LOOP;
      UPDATE public.erp_operations SET name = btrim(public.erp_text(p_command -> 'name', 'name')), unit = v_unit,
        sale_price = public.erp_money(p_command -> 'salePrice', 'salePrice', true),
        worker_rate = public.erp_money(p_command -> 'workerRate', 'workerRate', true),
        standard_minutes = public.erp_num(p_command -> 'standardMinutes', 'standardMinutes', true),
        machine_id = v_ref, employee_ids = v_employee_ids,
        active = public.erp_bool(p_command -> 'active', 'active'),
        auto_accept = public.erp_bool(p_command -> 'autoAccept', 'autoAccept'),
        norms = public.erp_norms(v_company, p_command -> 'norms') WHERE id = v_entity;
    WHEN 'item.create' THEN
      IF NOT (p_command ? 'customerId') THEN RAISE EXCEPTION 'customerId is required (UUID or null)' USING ERRCODE = '22023'; END IF;
      v_customer := CASE WHEN p_command -> 'customerId' = 'null'::jsonb THEN NULL ELSE public.erp_uuid(p_command -> 'customerId', 'customerId') END;
      IF v_customer IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.erp_customers WHERE company_id = v_company AND id = v_customer) THEN
        RAISE EXCEPTION 'Customer not found' USING ERRCODE = '22023';
      END IF;
      v_cost := public.erp_money(p_command -> 'cost', 'cost', true);
      v_kind := CASE WHEN p_command ? 'kind' THEN public.erp_text(p_command -> 'kind', 'kind') ELSE 'material' END;
      IF v_kind NOT IN ('material', 'blank', 'finished') THEN RAISE EXCEPTION 'Invalid item kind' USING ERRCODE = '22023'; END IF;
      v_sale := CASE WHEN p_command ? 'salePrice' THEN public.erp_money(p_command -> 'salePrice', 'salePrice', true) ELSE 0 END;
      v_category := CASE WHEN p_command ? 'category' AND p_command -> 'category' <> 'null'::jsonb
        THEN public.erp_text(p_command -> 'category', 'category') ELSE NULL END;
      IF v_category IS NOT NULL AND v_category !~ '^[0-9]{2}\.[0-9]{2}$' THEN
        RAISE EXCEPTION 'Invalid warehouse category' USING ERRCODE = '22023';
      END IF;
      IF v_customer IS NOT NULL AND v_cost <> 0 THEN
        RAISE EXCEPTION 'Customer-owned material must have zero business cost' USING ERRCODE = '22023';
      END IF;
      v_photo := CASE WHEN p_command ? 'photo' THEN btrim(p_command ->> 'photo') ELSE '' END;
      IF length(v_photo) > 200000 OR (v_photo <> '' AND v_photo !~ '^(data:image/(png|jpeg|webp);base64,|https?://)') THEN
        RAISE EXCEPTION 'Invalid photo' USING ERRCODE = '22023';
      END IF;
      v_qty := CASE WHEN p_command ? 'openQty' THEN public.erp_num(p_command -> 'openQty', 'openQty', true) ELSE 0 END;
      IF v_customer IS NOT NULL AND v_qty > 0 THEN
        RAISE EXCEPTION 'Customer-owned material cannot have opening stock' USING ERRCODE = '23514';
      END IF;
      INSERT INTO public.erp_items(company_id, name, unit, min_qty, cost, customer_id, kind, sale_price, last_purchase_price, material_cost, labor_cost, category, photo)
        VALUES (v_company, btrim(public.erp_text(p_command -> 'name', 'name')), public.erp_text(p_command -> 'unit', 'unit'),
        public.erp_num(p_command -> 'minQty', 'minQty', true), v_cost, v_customer, v_kind, v_sale, 0, v_cost, 0, v_category, v_photo) RETURNING id INTO v_entity;
      IF v_qty > 0 THEN
        INSERT INTO public.erp_stock_movements(company_id, item_id, direction, qty, unit_cost, source, source_id, note)
          VALUES (v_company, v_entity, 'in', v_qty, v_cost, 'inventory', v_entity, 'Boshlang‘ich qoldiq');
      END IF;
    WHEN 'item.update' THEN
      v_entity := public.erp_uuid(p_command -> 'itemId', 'itemId');
      SELECT * INTO v_item FROM public.erp_items WHERE company_id = v_company AND id = v_entity;
      IF NOT FOUND THEN RAISE EXCEPTION 'Item not found' USING ERRCODE = '22023'; END IF;
      v_category := CASE WHEN p_command ? 'category' AND p_command -> 'category' <> 'null'::jsonb
        THEN public.erp_text(p_command -> 'category', 'category') ELSE NULL END;
      IF v_category IS NOT NULL AND v_category !~ '^[0-9]{2}\.[0-9]{2}$' THEN
        RAISE EXCEPTION 'Invalid warehouse category' USING ERRCODE = '22023';
      END IF;
      v_photo := CASE WHEN p_command ? 'photo' THEN btrim(p_command ->> 'photo') ELSE NULL END;
      IF v_photo IS NOT NULL AND (length(v_photo) > 200000 OR (v_photo <> '' AND v_photo !~ '^(data:image/(png|jpeg|webp);base64,|https?://)')) THEN
        RAISE EXCEPTION 'Invalid photo' USING ERRCODE = '22023';
      END IF;
      UPDATE public.erp_items SET name = btrim(public.erp_text(p_command -> 'name', 'name')),
        unit = public.erp_text(p_command -> 'unit', 'unit'),
        min_qty = public.erp_num(p_command -> 'minQty', 'minQty', true),
        sale_price = CASE WHEN v_item.customer_id IS NULL
          THEN public.erp_money(p_command -> 'salePrice', 'salePrice', true) ELSE 0 END,
        category = v_category,
        photo = coalesce(v_photo, photo)
        WHERE id = v_entity;
    WHEN 'recipe.create' THEN
      v_output := public.erp_uuid(p_command -> 'outputItemId', 'outputItemId');
      SELECT * INTO v_item FROM public.erp_items WHERE company_id = v_company AND id = v_output;
      IF NOT FOUND OR v_item.customer_id IS NOT NULL OR v_item.kind NOT IN ('blank', 'finished') THEN
        RAISE EXCEPTION 'Recipe output must be a business-owned blank or finished item' USING ERRCODE = '22023';
      END IF;
      INSERT INTO public.erp_recipes(company_id, output_item_id, name)
        VALUES (v_company, v_output, btrim(public.erp_text(p_command -> 'name', 'name'))) RETURNING id INTO v_entity;
      INSERT INTO public.erp_recipe_versions(company_id, recipe_id, version)
        VALUES (v_company, v_entity, 1) RETURNING id INTO v_ref;
      PERFORM public.erp_insert_components(v_company, v_ref, p_command -> 'components');
      PERFORM public.erp_assert_recipes(v_company);
    WHEN 'recipe.version.create' THEN
      v_entity := public.erp_uuid(p_command -> 'recipeId', 'recipeId');
      SELECT * INTO v_recipe FROM public.erp_recipes WHERE company_id = v_company AND id = v_entity FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Recipe not found' USING ERRCODE = '22023'; END IF;
      IF NOT v_recipe.active THEN RAISE EXCEPTION 'Recipe is inactive' USING ERRCODE = '23514'; END IF;
      SELECT * INTO v_item FROM public.erp_items WHERE company_id = v_company AND id = v_recipe.output_item_id;
      IF NOT FOUND OR v_item.customer_id IS NOT NULL OR v_item.kind NOT IN ('blank', 'finished') THEN
        RAISE EXCEPTION 'Recipe output must be a business-owned blank or finished item' USING ERRCODE = '22023';
      END IF;
      SELECT coalesce(max(version), 0) + 1 INTO v_version FROM public.erp_recipe_versions
        WHERE company_id = v_company AND recipe_id = v_entity;
      INSERT INTO public.erp_recipe_versions(company_id, recipe_id, version)
        VALUES (v_company, v_entity, v_version) RETURNING id INTO v_ref;
      PERFORM public.erp_insert_components(v_company, v_ref, p_command -> 'components');
      PERFORM public.erp_assert_recipes(v_company);
    WHEN 'customer.receive' THEN
      v_entity := public.erp_uuid(p_command -> 'itemId', 'itemId');
      v_qty := public.erp_num(p_command -> 'qty', 'qty');
      SELECT * INTO v_item FROM public.erp_items WHERE company_id = v_company AND id = v_entity;
      IF NOT FOUND OR v_item.customer_id IS NULL THEN RAISE EXCEPTION 'Customer-owned item required' USING ERRCODE = '22023'; END IF;
      INSERT INTO public.erp_stock_movements(company_id, item_id, direction, qty, unit_cost, source, source_id, note)
        VALUES (v_company, v_item.id, 'in', v_qty, 0, 'customer', v_item.customer_id, public.erp_text(p_command -> 'note', 'note', true));
    WHEN 'order.create' THEN
      v_input := p_command -> 'input';
      IF v_input IS NULL OR jsonb_typeof(v_input) <> 'object' THEN RAISE EXCEPTION 'Order input required' USING ERRCODE = '22023'; END IF;
      v_customer := public.erp_uuid(v_input -> 'customerId', 'customerId');
      IF NOT EXISTS (SELECT 1 FROM public.erp_customers WHERE company_id = v_company AND id = v_customer) THEN
        RAISE EXCEPTION 'Customer not found' USING ERRCODE = '22023';
      END IF;
      v_kind := public.erp_text(v_input -> 'kind', 'kind');
      v_advance := public.erp_money(v_input -> 'advance', 'advance', true);
      v_account := public.erp_account(v_input -> 'account');
      v_markup := CASE WHEN v_input ? 'markup' THEN public.erp_signed_money(v_input -> 'markup', 'markup') ELSE 0 END;
      v_lines := v_input -> 'lines';
      IF v_lines IS NOT NULL THEN
        IF jsonb_typeof(v_lines) <> 'array' OR jsonb_array_length(v_lines) = 0 THEN
          RAISE EXCEPTION 'Order requires lines' USING ERRCODE = '22023';
        END IF;
        IF v_kind <> 'composite' AND jsonb_array_length(v_lines) > 1 THEN RAISE EXCEPTION 'Invalid order kind' USING ERRCODE = '22023'; END IF;
        SELECT coalesce(sum(public.erp_num(l.value -> 'qty', 'position qty')), 0),
          round(coalesce(sum(round(public.erp_num(l.value -> 'qty', 'position qty')
            * public.erp_money(l.value -> 'unitPrice', 'unit price', true), 2)), 0), 2),
          string_agg(btrim(public.erp_text(l.value -> 'title', 'title')), ' · ' ORDER BY l.ordinality),
          CASE WHEN count(DISTINCT public.erp_text(l.value -> 'kind', 'position kind')) = 1
            THEN min(public.erp_text(l.value -> 'kind', 'position kind')) ELSE 'composite' END
          INTO v_qty, v_amount, v_title, v_line_kind
          FROM jsonb_array_elements(v_lines) WITH ORDINALITY AS l(value, ordinality);
        IF v_line_kind NOT IN ('product', 'service', 'composite') THEN RAISE EXCEPTION 'Invalid position kind' USING ERRCODE = '22023'; END IF;
        IF v_amount + v_markup < 0 THEN RAISE EXCEPTION 'Markup exceeds order total' USING ERRCODE = '23514'; END IF;
        INSERT INTO public.erp_orders(company_id, number, kind, customer_id, title, qty, price, overhead, markup, due_date)
          VALUES (v_company, 'ORD-' || (SELECT lpad((count(*) + 1)::text, greatest(4, length((count(*) + 1)::text)), '0') FROM public.erp_orders WHERE company_id = v_company),
            v_line_kind, v_customer, v_title, v_qty, round(v_amount + v_markup, 2),
            public.erp_money(v_input -> 'overhead', 'overhead', true), v_markup, public.erp_date(v_input -> 'dueDate')) RETURNING * INTO v_order;
        v_entity := v_order.id;
        INSERT INTO public.erp_order_items(company_id, order_id, position, kind, title, qty, total)
          SELECT v_company, v_entity, (l.ordinality - 1)::integer, public.erp_text(l.value -> 'kind', 'position kind'),
            btrim(public.erp_text(l.value -> 'title', 'title')), public.erp_num(l.value -> 'qty', 'position qty'),
            round(public.erp_num(l.value -> 'qty', 'position qty') * public.erp_money(l.value -> 'unitPrice', 'unit price', true), 2)
            FROM jsonb_array_elements(v_lines) WITH ORDINALITY AS l(value, ordinality);
        FOR v_rec IN SELECT i.id AS line_id, i.qty AS line_qty, l.value AS definition
          FROM public.erp_order_items i
          JOIN jsonb_array_elements(v_lines) WITH ORDINALITY AS l(value, ordinality) ON l.ordinality = i.position + 1
          WHERE i.company_id = v_company AND i.order_id = v_entity ORDER BY i.position LOOP
          PERFORM public.erp_insert_materials(v_company, v_entity, v_rec.line_id, v_customer, v_rec.definition -> 'materials');
          PERFORM public.erp_insert_route(v_company, v_entity, v_rec.line_id, v_rec.line_qty, v_rec.definition -> 'route');
          PERFORM public.erp_insert_norm_materials(v_company, v_entity, v_rec.line_id);
        END LOOP;
      ELSE
        IF v_kind NOT IN ('product', 'service') THEN RAISE EXCEPTION 'Invalid order kind' USING ERRCODE = '22023'; END IF;
        v_qty := public.erp_num(v_input -> 'qty', 'qty');
        v_amount := public.erp_money(v_input -> 'price', 'price', true);
        v_title := public.erp_text(v_input -> 'title', 'title');
        IF v_amount + v_markup < 0 THEN RAISE EXCEPTION 'Markup exceeds order total' USING ERRCODE = '23514'; END IF;
        INSERT INTO public.erp_orders(company_id, number, kind, customer_id, title, qty, price, overhead, markup, due_date)
          VALUES (v_company, 'ORD-' || (SELECT lpad((count(*) + 1)::text, greatest(4, length((count(*) + 1)::text)), '0') FROM public.erp_orders WHERE company_id = v_company),
            v_kind, v_customer, v_title, v_qty, round(v_amount + v_markup, 2),
            public.erp_money(v_input -> 'overhead', 'overhead', true), v_markup, public.erp_date(v_input -> 'dueDate')) RETURNING * INTO v_order;
        v_entity := v_order.id;
        INSERT INTO public.erp_order_items(company_id, order_id, position, kind, title, qty, total)
          VALUES (v_company, v_entity, 0, v_kind, v_title, v_qty, v_amount) RETURNING id INTO v_line_id;
        PERFORM public.erp_insert_materials(v_company, v_entity, v_line_id, v_customer, v_input -> 'materials');
        PERFORM public.erp_insert_route(v_company, v_entity, v_line_id, v_qty, v_input -> 'route');
        PERFORM public.erp_insert_norm_materials(v_company, v_entity, v_line_id);
      END IF;
      IF v_advance > round(v_amount + v_markup, 2) THEN RAISE EXCEPTION 'Advance exceeds order total' USING ERRCODE = '23514'; END IF;
      IF v_advance > 0 THEN
        INSERT INTO public.erp_cash(company_id, direction, amount, account, source, source_id, customer_id, category, note, number)
          VALUES (v_company, 'in', v_advance, v_account, 'sale', v_customer, v_customer, 'sale', '', public.erp_cash_number(v_company, 'in'));
      END IF;
    WHEN 'order.update' THEN
      v_entity := public.erp_uuid(p_command -> 'orderId', 'orderId');
      SELECT * INTO v_order FROM public.erp_orders WHERE company_id = v_company AND id = v_entity FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Order not found' USING ERRCODE = '22023'; END IF;
      IF v_order.kind = 'series' THEN RAISE EXCEPTION 'Series orders follow their recipe' USING ERRCODE = '23514'; END IF;
      IF v_order.status NOT IN ('draft', 'production', 'ready') THEN
        RAISE EXCEPTION 'Order cannot be edited' USING ERRCODE = '23514';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM public.erp_customers WHERE company_id = v_company AND id = v_order.customer_id) THEN
        RAISE EXCEPTION 'Customer not found' USING ERRCODE = '22023';
      END IF;
      v_lines := p_command -> 'lines';
      UPDATE public.erp_orders SET overhead = public.erp_money(p_command -> 'overhead', 'overhead', true),
        due_date = public.erp_date(p_command -> 'dueDate'),
        markup = CASE WHEN p_command ? 'markup' THEN public.erp_signed_money(p_command -> 'markup', 'markup') ELSE markup END
        WHERE company_id = v_company AND id = v_entity;
      IF p_command ? 'lines' THEN
        IF jsonb_typeof(v_lines) <> 'array' OR jsonb_array_length(v_lines) = 0 THEN
          RAISE EXCEPTION 'Order requires lines' USING ERRCODE = '22023';
        END IF;
        IF (SELECT count(*) FROM jsonb_array_elements(v_lines) l WHERE l.value ? 'id')
          <> (SELECT count(DISTINCT public.erp_uuid(l.value -> 'id', 'id')) FROM jsonb_array_elements(v_lines) l WHERE l.value ? 'id') THEN
          RAISE EXCEPTION 'Duplicate order line' USING ERRCODE = '22023';
        END IF;
        IF EXISTS (SELECT 1 FROM public.erp_order_items i WHERE i.company_id = v_company AND i.order_id = v_entity
          AND i.status <> 'cancelled' AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_lines) l
            WHERE l.value ? 'id' AND public.erp_uuid(l.value -> 'id', 'id') = i.id)) THEN
          RAISE EXCEPTION 'Order line cannot be removed' USING ERRCODE = '23514';
        END IF;
        UPDATE public.erp_order_items SET position = position + 1000000 WHERE company_id = v_company AND order_id = v_entity;
        UPDATE public.erp_order_materials SET position = position + 1000000 WHERE company_id = v_company AND order_id = v_entity;
        UPDATE public.erp_tasks SET position = position + 1000000 WHERE company_id = v_company AND order_id = v_entity;
        v_pos := 0;
        v_pos_material := 0;
        v_pos_task := 0;
        FOR v_rec IN SELECT l.value AS definition, l.ordinality FROM jsonb_array_elements(v_lines) WITH ORDINALITY AS l(value, ordinality)
          ORDER BY l.ordinality LOOP
          v_line_kind := public.erp_text(v_rec.definition -> 'kind', 'position kind');
          IF v_line_kind NOT IN ('product', 'service') THEN RAISE EXCEPTION 'Invalid order kind' USING ERRCODE = '22023'; END IF;
          v_title := btrim(public.erp_text(v_rec.definition -> 'title', 'title'));
          v_qty := public.erp_num(v_rec.definition -> 'qty', 'position qty');
          v_amount := round(v_qty * public.erp_money(v_rec.definition -> 'unitPrice', 'unit price', true), 2);
          IF v_rec.definition ? 'id' THEN
            v_line_id := public.erp_uuid(v_rec.definition -> 'id', 'id');
            SELECT * INTO v_line_row FROM public.erp_order_items
              WHERE company_id = v_company AND order_id = v_entity AND id = v_line_id FOR UPDATE;
            IF NOT FOUND THEN RAISE EXCEPTION 'Order line not found' USING ERRCODE = '22023'; END IF;
            IF v_line_row.status = 'cancelled' THEN
              RAISE EXCEPTION 'Cancelled position cannot be revised' USING ERRCODE = '23514';
            END IF;
            v_line_status := v_line_row.status;
            IF public.erp_line_shipped(v_company, v_line_id) > v_qty THEN
              RAISE EXCEPTION 'Quantity is below shipped quantity' USING ERRCODE = '23514';
            END IF;
            UPDATE public.erp_order_items SET position = v_pos, kind = v_line_kind, title = v_title, qty = v_qty, total = v_amount
              WHERE company_id = v_company AND id = v_line_id;
          ELSE
            INSERT INTO public.erp_order_items(company_id, order_id, position, kind, title, qty, total, status)
              VALUES (v_company, v_entity, v_pos, v_line_kind, v_title, v_qty, v_amount,
                CASE WHEN v_order.status = 'draft' THEN 'draft' ELSE 'production' END)
              RETURNING id INTO v_line_id;
            v_line_status := CASE WHEN v_order.status = 'draft' THEN 'draft' ELSE 'production' END;
          END IF;
          IF v_line_status = 'draft' THEN
            DELETE FROM public.erp_order_materials WHERE company_id = v_company AND line_id = v_line_id;
            DELETE FROM public.erp_tasks WHERE company_id = v_company AND line_id = v_line_id;
          END IF;
          v_pos_material := public.erp_revise_materials(v_company, v_entity, v_line_id, v_order.customer_id,
            v_rec.definition -> 'materials', v_pos_material);
          SELECT coalesce(jsonb_agg(jsonb_build_object('operationId', t.operation_id, 'planned', t.planned)), '[]'::jsonb)
            INTO v_old_tasks FROM public.erp_tasks t WHERE t.company_id = v_company AND t.line_id = v_line_id;
          v_pos_task := public.erp_revise_route(v_company, v_entity, v_line_id, v_qty,
            v_rec.definition -> 'route', v_pos_task);
          IF v_line_status <> 'draft' THEN
            SELECT coalesce(jsonb_agg(jsonb_build_object('operationId', t.operation_id, 'planned', t.planned)), '[]'::jsonb)
              INTO v_new_tasks FROM public.erp_tasks t WHERE t.company_id = v_company AND t.line_id = v_line_id;
            PERFORM public.erp_norm_delta(v_company, v_entity, v_line_id, v_order.customer_id, v_old_tasks, v_new_tasks);
          END IF;
          IF v_line_status = 'ready' AND (EXISTS (SELECT 1 FROM public.erp_order_materials
              WHERE company_id = v_company AND line_id = v_line_id AND issued_qty < qty)
            OR EXISTS (SELECT 1 FROM public.erp_tasks
              WHERE company_id = v_company AND line_id = v_line_id AND completed < planned)) THEN
            UPDATE public.erp_order_items SET status = 'production' WHERE company_id = v_company AND id = v_line_id;
          END IF;
          v_pos := v_pos + 1;
        END LOOP;
        PERFORM public.erp_sync_identity(v_company, v_entity);
        PERFORM public.erp_sync_order(v_company, v_entity);
      ELSE
        IF (SELECT count(*) FROM public.erp_order_items
          WHERE company_id = v_company AND order_id = v_entity AND status <> 'cancelled') <> 1 THEN
          RAISE EXCEPTION 'Order positions require a line revision' USING ERRCODE = '23514';
        END IF;
        SELECT * INTO v_line_row FROM public.erp_order_items
          WHERE company_id = v_company AND order_id = v_entity AND status <> 'cancelled'
          ORDER BY position FOR UPDATE;
        v_qty := public.erp_num(p_command -> 'qty', 'qty');
        v_amount := public.erp_money(p_command -> 'price', 'price', true);
        v_title := btrim(public.erp_text(p_command -> 'title', 'title'));
        IF public.erp_line_shipped(v_company, v_line_row.id) > v_qty THEN
          RAISE EXCEPTION 'Quantity is below shipped quantity' USING ERRCODE = '23514';
        END IF;
        UPDATE public.erp_order_materials SET position = position + 1000000 WHERE company_id = v_company AND order_id = v_entity;
        UPDATE public.erp_tasks SET position = position + 1000000 WHERE company_id = v_company AND order_id = v_entity;
        IF v_line_row.status = 'draft' THEN
          DELETE FROM public.erp_order_materials WHERE company_id = v_company AND line_id = v_line_row.id;
          DELETE FROM public.erp_tasks WHERE company_id = v_company AND line_id = v_line_row.id;
        END IF;
        PERFORM public.erp_revise_materials(v_company, v_entity, v_line_row.id, v_order.customer_id,
          p_command -> 'materials', 0);
        SELECT coalesce(jsonb_agg(jsonb_build_object('operationId', t.operation_id, 'planned', t.planned)), '[]'::jsonb)
          INTO v_old_tasks FROM public.erp_tasks t WHERE t.company_id = v_company AND t.line_id = v_line_row.id;
        PERFORM public.erp_revise_route(v_company, v_entity, v_line_row.id, v_qty, p_command -> 'route', 0);
        IF v_line_row.status <> 'draft' THEN
          SELECT coalesce(jsonb_agg(jsonb_build_object('operationId', t.operation_id, 'planned', t.planned)), '[]'::jsonb)
            INTO v_new_tasks FROM public.erp_tasks t WHERE t.company_id = v_company AND t.line_id = v_line_row.id;
          PERFORM public.erp_norm_delta(v_company, v_entity, v_line_row.id, v_order.customer_id, v_old_tasks, v_new_tasks);
        END IF;
        IF v_line_row.status = 'ready' AND (EXISTS (SELECT 1 FROM public.erp_order_materials
            WHERE company_id = v_company AND line_id = v_line_row.id AND issued_qty < qty)
          OR EXISTS (SELECT 1 FROM public.erp_tasks
            WHERE company_id = v_company AND line_id = v_line_row.id AND completed < planned)) THEN
          UPDATE public.erp_order_items SET status = 'production' WHERE company_id = v_company AND id = v_line_row.id;
        END IF;
        UPDATE public.erp_order_items SET title = v_title, qty = v_qty, total = v_amount
          WHERE company_id = v_company AND id = v_line_row.id;
        PERFORM public.erp_sync_identity(v_company, v_entity);
        PERFORM public.erp_sync_order(v_company, v_entity);
      END IF;
    WHEN 'series.create' THEN
      v_input := p_command -> 'input';
      IF v_input IS NULL OR jsonb_typeof(v_input) <> 'object' THEN RAISE EXCEPTION 'Series input required' USING ERRCODE = '22023'; END IF;
      v_output := public.erp_uuid(v_input -> 'outputItemId', 'outputItemId');
      v_ref := public.erp_uuid(v_input -> 'recipeVersionId', 'recipeVersionId');
      SELECT * INTO v_recipe_version FROM public.erp_recipe_versions
        WHERE company_id = v_company AND id = v_ref FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Recipe version not found' USING ERRCODE = '22023'; END IF;
      SELECT * INTO v_recipe FROM public.erp_recipes
        WHERE company_id = v_company AND id = v_recipe_version.recipe_id FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Recipe not found' USING ERRCODE = '22023'; END IF;
      IF NOT v_recipe.active THEN RAISE EXCEPTION 'Recipe is inactive' USING ERRCODE = '23514'; END IF;
      SELECT * INTO v_item FROM public.erp_items WHERE company_id = v_company AND id = v_recipe.output_item_id;
      IF NOT FOUND OR v_item.customer_id IS NOT NULL OR v_item.kind NOT IN ('blank', 'finished') THEN
        RAISE EXCEPTION 'Recipe output must be a business-owned blank or finished item' USING ERRCODE = '22023';
      END IF;
      IF v_recipe.output_item_id <> v_output THEN RAISE EXCEPTION 'Recipe does not produce this item' USING ERRCODE = '23514'; END IF;
      v_qty := public.erp_num(v_input -> 'qty', 'qty');
      IF v_input -> 'substitutions' IS NOT NULL AND jsonb_typeof(v_input -> 'substitutions') <> 'object' THEN
        RAISE EXCEPTION 'substitutions must be an object' USING ERRCODE = '22023';
      END IF;
      v_subs := coalesce(v_input -> 'substitutions', '{}'::jsonb);
      FOR v_slot IN SELECT jsonb_object_keys(v_subs) LOOP
        IF NOT EXISTS (SELECT 1 FROM public.erp_recipe_components c
          WHERE c.company_id = v_company AND c.version_id = v_ref AND c.slot = v_slot) THEN
          RAISE EXCEPTION 'Unknown substitution slot' USING ERRCODE = '22023';
        END IF;
      END LOOP;
      INSERT INTO public.erp_orders(company_id, number, kind, customer_id, title, qty, price, overhead, due_date,
        output_item_id, recipe_version_id, substitutions)
        VALUES (v_company, 'ORD-' || (SELECT lpad((count(*) + 1)::text, greatest(4, length((count(*) + 1)::text)), '0') FROM public.erp_orders WHERE company_id = v_company),
          'series', NULL, v_recipe.name || ' · v' || v_recipe_version.version, v_qty, 0, 0,
          public.erp_date(v_input -> 'dueDate'), v_output, v_ref, v_subs) RETURNING * INTO v_order;
      v_entity := v_order.id;
      INSERT INTO public.erp_order_items(company_id, order_id, position, kind, title, qty, total)
        VALUES (v_company, v_entity, 0, 'product', v_order.title, v_qty, 0) RETURNING id INTO v_line_id;
      v_pos := 0;
      FOR v_component IN SELECT * FROM public.erp_recipe_components
        WHERE company_id = v_company AND version_id = v_ref ORDER BY position LOOP
        IF v_subs ? v_component.slot THEN
          v_chosen := public.erp_uuid(v_subs -> v_component.slot, 'substitution');
        ELSE
          v_chosen := v_component.item_id;
        END IF;
        IF v_chosen IS NULL THEN RAISE EXCEPTION 'Every recipe slot requires a selected item' USING ERRCODE = '23514'; END IF;
        IF (v_component.item_id IS NULL AND NOT (v_chosen = ANY(v_component.allowed_item_ids)))
          OR (v_component.item_id IS NOT NULL AND v_chosen <> v_component.item_id AND NOT (v_chosen = ANY(v_component.allowed_item_ids))) THEN
          RAISE EXCEPTION 'Substitution is not allowed for this slot' USING ERRCODE = '23514';
        END IF;
        SELECT * INTO v_item FROM public.erp_items WHERE company_id = v_company AND id = v_chosen;
        IF NOT FOUND THEN RAISE EXCEPTION 'Recipe item not found' USING ERRCODE = '22023'; END IF;
        IF v_item.customer_id IS NOT NULL THEN RAISE EXCEPTION 'Customer materials cannot be used in recipes' USING ERRCODE = '23514'; END IF;
        IF EXISTS (SELECT 1 FROM public.erp_order_materials WHERE company_id = v_company AND order_id = v_entity AND item_id = v_chosen) THEN
          RAISE EXCEPTION 'Duplicate recipe component' USING ERRCODE = '23514';
        END IF;
        INSERT INTO public.erp_order_materials(company_id, order_id, line_id, item_id, position, qty, estimated_cost)
          VALUES (v_company, v_entity, v_line_id, v_chosen, v_pos, v_qty * v_component.qty_per_unit, v_item.cost);
        v_pos := v_pos + 1;
      END LOOP;
      PERFORM public.erp_insert_route(v_company, v_entity, v_line_id, v_qty, v_input -> 'route');
    WHEN 'order.launch' THEN
      v_entity := public.erp_uuid(p_command -> 'orderId', 'orderId');
      SELECT * INTO v_order FROM public.erp_orders WHERE company_id = v_company AND id = v_entity;
      IF NOT FOUND OR v_order.status <> 'draft' THEN RAISE EXCEPTION 'Only draft orders can launch' USING ERRCODE = '23514'; END IF;
      IF NOT EXISTS (SELECT 1 FROM public.erp_tasks WHERE company_id = v_company AND order_id = v_entity) OR EXISTS (
        SELECT 1 FROM public.erp_tasks t JOIN public.erp_employees e ON e.company_id = t.company_id AND e.id = t.employee_id
        WHERE t.company_id = v_company AND t.order_id = v_entity AND NOT e.active
      ) THEN RAISE EXCEPTION 'An active production route is required' USING ERRCODE = '23514'; END IF;
      FOR v_material IN SELECT * FROM public.erp_order_materials WHERE company_id = v_company AND order_id = v_entity LOOP
        IF v_material.qty > public.erp_stock_qty(v_company, v_material.item_id) - public.erp_reserved_qty(v_company, v_material.item_id) THEN
          RAISE EXCEPTION 'Insufficient unreserved material stock' USING ERRCODE = '23514';
        END IF;
      END LOOP;
      UPDATE public.erp_orders SET status = 'production' WHERE company_id = v_company AND id = v_entity;
      UPDATE public.erp_order_items SET status = 'production'
        WHERE company_id = v_company AND order_id = v_entity AND status <> 'cancelled';
      PERFORM public.erp_ready(v_company, v_entity);
    WHEN 'order.issue' THEN
      v_entity := public.erp_uuid(p_command -> 'orderId', 'orderId');
      SELECT * INTO v_order FROM public.erp_orders WHERE company_id = v_company AND id = v_entity;
      IF NOT FOUND OR v_order.status <> 'production' THEN RAISE EXCEPTION 'Production order required' USING ERRCODE = '23514'; END IF;
      v_line_id := CASE WHEN p_command ? 'lineId' THEN public.erp_uuid(p_command -> 'lineId', 'lineId') ELSE NULL END;
      IF v_line_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.erp_order_items
        WHERE company_id = v_company AND order_id = v_entity AND id = v_line_id) THEN
        RAISE EXCEPTION 'Order line not found' USING ERRCODE = '22023';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM public.erp_order_materials WHERE company_id = v_company AND order_id = v_entity
        AND issued_qty < qty AND (v_line_id IS NULL OR line_id = v_line_id)) THEN
        RAISE EXCEPTION 'All materials already issued' USING ERRCODE = '23514';
      END IF;
      FOR v_material IN SELECT * FROM public.erp_order_materials WHERE company_id = v_company AND order_id = v_entity
        AND issued_qty < qty AND (v_line_id IS NULL OR line_id = v_line_id) ORDER BY position LOOP
        SELECT * INTO STRICT v_item FROM public.erp_items WHERE company_id = v_company AND id = v_material.item_id;
        IF v_item.customer_id IS NOT NULL AND v_item.customer_id <> v_order.customer_id THEN
          RAISE EXCEPTION 'Material belongs to another customer' USING ERRCODE = '23514';
        END IF;
        v_qty := v_material.qty - v_material.issued_qty;
        IF v_qty > public.erp_stock_qty(v_company, v_item.id) - public.erp_reserved_qty(v_company, v_item.id, v_entity) THEN
          RAISE EXCEPTION 'Insufficient stock for issue' USING ERRCODE = '23514';
        END IF;
        INSERT INTO public.erp_stock_movements(company_id, item_id, direction, qty, unit_cost, source, source_id, note)
          VALUES (v_company, v_item.id, 'out', v_qty,
            CASE WHEN v_item.customer_id IS NULL THEN v_item.cost ELSE 0 END, 'order', v_entity, 'Production issue');
        UPDATE public.erp_order_materials SET issued_qty = qty,
          actual_cost = CASE WHEN v_item.customer_id IS NULL THEN v_item.cost ELSE 0 END WHERE id = v_material.id;
      END LOOP;
      PERFORM public.erp_ready(v_company, v_entity);
    WHEN 'order.cancel' THEN
      v_entity := public.erp_uuid(p_command -> 'orderId', 'orderId');
      SELECT * INTO v_order FROM public.erp_orders WHERE company_id = v_company AND id = v_entity;
      IF NOT FOUND OR v_order.status NOT IN ('draft', 'production', 'ready') THEN
        RAISE EXCEPTION 'Order cannot be cancelled' USING ERRCODE = '23514';
      END IF;
      IF EXISTS (SELECT 1 FROM public.erp_shipments
        WHERE company_id = v_company AND order_id = v_entity AND status <> 'cancelled') THEN
        RAISE EXCEPTION 'Shipped orders cannot be cancelled' USING ERRCODE = '23514';
      END IF;
      IF EXISTS (SELECT 1 FROM public.erp_stock_movements
        WHERE company_id = v_company AND source = 'production' AND source_id = v_entity) THEN
        RAISE EXCEPTION 'Produced stock cannot be cancelled' USING ERRCODE = '23514';
      END IF;
      FOR v_material IN SELECT * FROM public.erp_order_materials
        WHERE company_id = v_company AND order_id = v_entity AND issued_qty > 0 ORDER BY position LOOP
        IF NOT EXISTS (SELECT 1 FROM public.erp_items WHERE company_id = v_company AND id = v_material.item_id) THEN
          RAISE EXCEPTION 'Material item not found' USING ERRCODE = '22023';
        END IF;
        INSERT INTO public.erp_stock_movements(company_id, item_id, direction, qty, unit_cost, source, source_id, note)
          VALUES (v_company, v_material.item_id, 'in', v_material.issued_qty, v_material.actual_cost, 'order', v_entity,
            'Bekor qilingan buyurtma materiali qaytarildi');
        UPDATE public.erp_order_materials SET issued_qty = 0, actual_cost = 0 WHERE id = v_material.id;
      END LOOP;
      UPDATE public.erp_order_items SET status = 'cancelled' WHERE company_id = v_company AND order_id = v_entity;
      UPDATE public.erp_orders SET status = 'cancelled' WHERE company_id = v_company AND id = v_entity;
    WHEN 'orderLine.cancel' THEN
      v_entity := public.erp_uuid(p_command -> 'orderId', 'orderId');
      v_line_id := public.erp_uuid(p_command -> 'lineId', 'lineId');
      SELECT * INTO v_order FROM public.erp_orders WHERE company_id = v_company AND id = v_entity FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Order not found' USING ERRCODE = '22023'; END IF;
      IF v_order.kind = 'series' THEN RAISE EXCEPTION 'Stock production has no order lines' USING ERRCODE = '23514'; END IF;
      IF v_order.status NOT IN ('draft', 'production', 'ready') THEN
        RAISE EXCEPTION 'Order cannot be edited' USING ERRCODE = '23514';
      END IF;
      SELECT * INTO v_line_row FROM public.erp_order_items
        WHERE company_id = v_company AND order_id = v_entity AND id = v_line_id FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Order line not found' USING ERRCODE = '22023'; END IF;
      IF v_line_row.status NOT IN ('draft', 'production', 'ready') THEN
        RAISE EXCEPTION 'Delivered work cannot be cancelled' USING ERRCODE = '23514';
      END IF;
      IF public.erp_line_shipped(v_company, v_line_id) > 0 THEN
        RAISE EXCEPTION 'Shipped line cannot be cancelled' USING ERRCODE = '23514';
      END IF;
      IF EXISTS (SELECT 1 FROM public.erp_tasks WHERE company_id = v_company AND line_id = v_line_id
        AND executor_kind = 'supplier' AND status = 'completed') THEN
        RAISE EXCEPTION 'Accepted outsourced work cannot be cancelled' USING ERRCODE = '23514';
      END IF;
      FOR v_material IN SELECT * FROM public.erp_order_materials
        WHERE company_id = v_company AND line_id = v_line_id AND issued_qty > 0 ORDER BY position LOOP
        IF NOT EXISTS (SELECT 1 FROM public.erp_items WHERE company_id = v_company AND id = v_material.item_id) THEN
          RAISE EXCEPTION 'Material item not found' USING ERRCODE = '22023';
        END IF;
        INSERT INTO public.erp_stock_movements(company_id, item_id, direction, qty, unit_cost, source, source_id, note)
          VALUES (v_company, v_material.item_id, 'in', v_material.issued_qty, v_material.actual_cost, 'order', v_entity,
            'Bekor qilingan buyurtma materiali qaytarildi');
      END LOOP;
      DELETE FROM public.erp_order_materials WHERE company_id = v_company AND line_id = v_line_id;
      DELETE FROM public.erp_tasks WHERE company_id = v_company AND line_id = v_line_id
        AND NOT public.erp_task_started(v_company, v_entity, id);
      UPDATE public.erp_order_items SET status = 'cancelled' WHERE company_id = v_company AND id = v_line_id;
      PERFORM public.erp_sync_identity(v_company, v_entity);
      PERFORM public.erp_sync_order(v_company, v_entity);
      v_entity := v_line_id;
    WHEN 'customer.pay' THEN
      v_customer := public.erp_uuid(p_command -> 'customerId', 'customerId');
      v_amount := public.erp_money(p_command -> 'amount', 'amount');
      v_account := public.erp_account(p_command -> 'account');
      IF NOT EXISTS (SELECT 1 FROM public.erp_customers WHERE company_id = v_company AND id = v_customer) THEN
        RAISE EXCEPTION 'Customer not found' USING ERRCODE = '22023';
      END IF;
      INSERT INTO public.erp_cash(company_id, direction, amount, account, source, source_id, customer_id, category, note, number)
        VALUES (v_company, 'in', v_amount, v_account, 'sale', v_customer, v_customer, 'sale', '', public.erp_cash_number(v_company, 'in')) RETURNING id INTO v_entity;
    WHEN 'work.accept' THEN
      v_task := public.erp_work_task(v_company, v_actor, public.erp_uuid(p_command -> 'orderId', 'orderId'),
        public.erp_uuid(p_command -> 'taskId', 'taskId'));
      IF v_task.status <> 'assigned' THEN RAISE EXCEPTION 'Task is not awaiting acceptance' USING ERRCODE = '23514'; END IF;
      UPDATE public.erp_tasks SET status = 'accepted' WHERE id = v_task.id;
      v_entity := v_task.id;
    WHEN 'outsource.accept' THEN
      v_entity := public.erp_uuid(p_command -> 'taskId', 'taskId');
      SELECT * INTO v_task FROM public.erp_tasks WHERE company_id = v_company AND id = v_entity FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Task not found' USING ERRCODE = '22023'; END IF;
      SELECT * INTO v_order FROM public.erp_orders WHERE company_id = v_company AND id = v_task.order_id FOR UPDATE;
      IF v_order.status <> 'production' THEN RAISE EXCEPTION 'Order is not in production' USING ERRCODE = '23514'; END IF;
      IF NOT EXISTS (SELECT 1 FROM public.erp_order_items
        WHERE company_id = v_company AND id = v_task.line_id AND status = 'production') THEN
        RAISE EXCEPTION 'Order line is not in production' USING ERRCODE = '23514';
      END IF;
      IF v_task.executor_kind <> 'supplier' OR v_task.supplier_id IS NULL THEN
        RAISE EXCEPTION 'Not an outsourced task' USING ERRCODE = '23514';
      END IF;
      IF v_task.status <> 'assigned' OR v_task.completed <> 0 THEN
        RAISE EXCEPTION 'Outsourced task is already accepted' USING ERRCODE = '23514';
      END IF;
      IF NOT (v_task.supplier_cost > 0 OR v_task.rate > 0) THEN
        RAISE EXCEPTION 'Supplier amount is required before acceptance' USING ERRCODE = '23514';
      END IF;
      UPDATE public.erp_tasks SET completed = planned, status = 'completed'
        WHERE company_id = v_company AND id = v_task.id;
      PERFORM public.erp_ready(v_company, v_task.order_id);
    WHEN 'work.start' THEN
      v_task := public.erp_work_task(v_company, v_actor, public.erp_uuid(p_command -> 'orderId', 'orderId'),
        public.erp_uuid(p_command -> 'taskId', 'taskId'));
      IF v_task.status <> 'accepted' THEN RAISE EXCEPTION 'Task must be accepted before start' USING ERRCODE = '23514'; END IF;
      UPDATE public.erp_tasks SET status = 'in_progress' WHERE id = v_task.id;
      v_entity := v_task.id;
    WHEN 'work.submit' THEN
      v_task := public.erp_work_task(v_company, v_actor, public.erp_uuid(p_command -> 'orderId', 'orderId'),
        public.erp_uuid(p_command -> 'taskId', 'taskId'));
      IF v_task.status <> 'in_progress' THEN RAISE EXCEPTION 'Task must be started before submission' USING ERRCODE = '23514'; END IF;
      v_qty := public.erp_num(p_command -> 'qty', 'qty');
      IF v_qty > v_task.planned - v_task.completed THEN RAISE EXCEPTION 'Report exceeds remaining quantity' USING ERRCODE = '23514'; END IF;
      IF EXISTS (SELECT 1 FROM public.erp_work_reports
        WHERE company_id = v_company AND order_id = v_task.order_id AND task_id = v_task.id
          AND employee_id = v_task.employee_id AND status = 'submitted') THEN
        RAISE EXCEPTION 'Report already submitted' USING ERRCODE = '23514';
      END IF;
      INSERT INTO public.erp_work_reports(company_id, order_id, task_id, employee_id, qty, note)
        VALUES (v_company, v_task.order_id, v_task.id, v_task.employee_id, v_qty, public.erp_text(p_command -> 'note', 'note', true))
        RETURNING * INTO v_report;
      SELECT * INTO STRICT v_operation FROM public.erp_operations WHERE company_id = v_company AND id = v_task.operation_id;
      IF v_operation.auto_accept THEN
        v_new_completed := least(v_task.planned, v_task.completed + v_qty);
        UPDATE public.erp_work_reports SET status = 'accepted' WHERE id = v_report.id;
        UPDATE public.erp_tasks SET completed = v_new_completed,
          status = CASE WHEN v_new_completed >= v_task.planned THEN 'completed' ELSE 'in_progress' END WHERE id = v_task.id;
        v_amount := round(v_task.rate * v_new_completed, 2);
        SELECT * INTO v_payroll FROM public.erp_payroll
          WHERE company_id = v_company AND order_id = v_task.order_id AND task_id = v_task.id AND employee_id = v_task.employee_id FOR UPDATE;
        IF v_payroll.id IS NOT NULL THEN
          UPDATE public.erp_payroll SET report_id = v_report.id, amount = v_amount, status = 'accepted' WHERE id = v_payroll.id;
        ELSE
          INSERT INTO public.erp_payroll(company_id, employee_id, report_id, order_id, task_id, amount, status)
            VALUES (v_company, v_task.employee_id, v_report.id, v_task.order_id, v_task.id, v_amount, 'accepted');
        END IF;
        PERFORM public.erp_ready(v_company, v_task.order_id);
      ELSE
        v_amount := round(v_task.rate * (v_task.completed + v_qty), 2);
        SELECT * INTO v_payroll FROM public.erp_payroll
          WHERE company_id = v_company AND order_id = v_task.order_id AND task_id = v_task.id AND employee_id = v_task.employee_id FOR UPDATE;
        IF FOUND THEN
          IF v_payroll.status <> 'accepted' THEN
            UPDATE public.erp_payroll SET report_id = v_report.id, amount = v_amount, status = 'pending' WHERE id = v_payroll.id;
          END IF;
        ELSE
          INSERT INTO public.erp_payroll(company_id, employee_id, report_id, order_id, task_id, amount, status)
            VALUES (v_company, v_task.employee_id, v_report.id, v_task.order_id, v_task.id, v_amount, 'pending');
        END IF;
        UPDATE public.erp_tasks SET status = 'submitted' WHERE id = v_task.id;
      END IF;
      v_entity := v_report.id;
    WHEN 'work.review' THEN
      v_entity := public.erp_uuid(p_command -> 'reportId', 'reportId');
      v_accept := public.erp_bool(p_command -> 'accept', 'accept');
      IF v_accept AND (p_command ? 'defectQty' OR p_command ? 'reason' OR p_command ? 'note') THEN
        RAISE EXCEPTION 'Review must be plain' USING ERRCODE = '22023';
      END IF;
      v_note := btrim(coalesce(p_command ->> 'note', ''));
      IF NOT v_accept THEN
        v_reason := p_command ->> 'reason';
        IF v_reason IS NULL OR v_reason NOT IN ('quality', 'measurement', 'drawing', 'customer', 'other') THEN
          RAISE EXCEPTION 'Defect reason is required' USING ERRCODE = '23514';
        END IF;
        IF v_reason = 'other' AND v_note = '' THEN RAISE EXCEPTION 'Defect note is required' USING ERRCODE = '23514'; END IF;
        IF length(v_note) > 500 THEN RAISE EXCEPTION 'Defect note is too long' USING ERRCODE = '23514'; END IF;
      END IF;
      SELECT * INTO v_report FROM public.erp_work_reports WHERE company_id = v_company AND id = v_entity FOR UPDATE;
      IF NOT FOUND OR v_report.status <> 'submitted' THEN RAISE EXCEPTION 'Report is not awaiting review' USING ERRCODE = '23514'; END IF;
      SELECT * INTO v_order FROM public.erp_orders WHERE company_id = v_company AND id = v_report.order_id FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Order not found' USING ERRCODE = '22023'; END IF;
      SELECT * INTO v_task FROM public.erp_tasks WHERE company_id = v_company AND id = v_report.task_id FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Task not found' USING ERRCODE = '22023'; END IF;
      IF v_report.employee_id <> v_task.employee_id THEN RAISE EXCEPTION 'Report employee is not assigned' USING ERRCODE = '23514'; END IF;
      IF v_order.status <> 'production' OR EXISTS (SELECT 1 FROM public.erp_order_materials WHERE company_id = v_company AND order_id = v_order.id AND issued_qty < qty) THEN
        RAISE EXCEPTION 'Materials must be issued before review' USING ERRCODE = '23514';
      END IF;
      IF v_task.status <> 'submitted' THEN RAISE EXCEPTION 'Task is not awaiting review' USING ERRCODE = '23514'; END IF;
      SELECT * INTO STRICT v_operation FROM public.erp_operations WHERE company_id = v_company AND id = v_task.operation_id;
      SELECT * INTO STRICT v_employee FROM public.erp_employees WHERE company_id = v_company AND id = v_report.employee_id;
      SELECT * INTO v_payroll FROM public.erp_payroll
        WHERE company_id = v_company AND order_id = v_task.order_id AND task_id = v_task.id AND employee_id = v_task.employee_id FOR UPDATE;
      IF v_accept THEN
        v_good := v_report.qty;
      ELSE
        v_defect := round(CASE WHEN p_command ? 'defectQty' THEN public.erp_num(p_command -> 'defectQty', 'defectQty', true) ELSE v_report.qty END, 2);
        IF v_defect <= 0 THEN RAISE EXCEPTION 'Nothing to reject' USING ERRCODE = '23514'; END IF;
        IF v_defect > v_report.qty THEN RAISE EXCEPTION 'Defect quantity exceeds report' USING ERRCODE = '23514'; END IF;
        v_good := round(v_report.qty - v_defect, 2);
      END IF;
      IF v_good > 0 THEN
        IF NOT v_employee.active THEN RAISE EXCEPTION 'Employee is inactive' USING ERRCODE = '22023'; END IF;
        IF NOT (v_task.employee_id = ANY(v_operation.employee_ids)) THEN
          RAISE EXCEPTION 'Worker is not authorized for this operation' USING ERRCODE = '23514';
        END IF;
        IF EXISTS (SELECT 1 FROM public.erp_tasks WHERE company_id = v_company AND line_id = v_task.line_id
          AND position < v_task.position AND completed < planned) THEN
          RAISE EXCEPTION 'Previous route stage is incomplete' USING ERRCODE = '23514';
        END IF;
        IF v_good > v_task.planned - v_task.completed THEN RAISE EXCEPTION 'Report exceeds remaining quantity' USING ERRCODE = '23514'; END IF;
        v_new_completed := least(v_task.planned, v_task.completed + v_good);
        UPDATE public.erp_work_reports SET qty = v_good, status = 'accepted' WHERE id = v_entity;
        UPDATE public.erp_tasks SET completed = v_new_completed,
          status = CASE WHEN v_new_completed >= v_task.planned THEN 'completed' ELSE 'in_progress' END WHERE id = v_task.id;
        v_amount := round(v_task.rate * v_new_completed, 2);
        IF v_payroll.id IS NOT NULL THEN
          UPDATE public.erp_payroll SET report_id = v_entity, amount = v_amount, status = 'accepted' WHERE id = v_payroll.id;
        ELSE
          INSERT INTO public.erp_payroll(company_id, employee_id, report_id, order_id, task_id, amount, status)
            VALUES (v_company, v_task.employee_id, v_entity, v_task.order_id, v_task.id, v_amount, 'accepted');
        END IF;
        PERFORM public.erp_ready(v_company, v_order.id);
      ELSE
        UPDATE public.erp_work_reports SET status = 'rejected' WHERE id = v_entity;
        UPDATE public.erp_tasks SET status = 'in_progress' WHERE id = v_task.id;
        IF v_payroll.id IS NOT NULL THEN
          UPDATE public.erp_payroll SET amount = round(v_task.rate * v_task.completed, 2),
            status = CASE WHEN v_payroll.status = 'accepted' THEN 'accepted' ELSE 'rejected' END WHERE id = v_payroll.id;
        END IF;
      END IF;
      IF NOT v_accept THEN
        INSERT INTO public.erp_defects(company_id, report_id, order_id, line_id, task_id, employee_id, operation_id, qty, reason, note, materials)
          VALUES (v_company, v_report.id, v_order.id, v_task.line_id, v_task.id, v_report.employee_id, v_task.operation_id,
            v_defect, v_reason, v_note,
            CASE WHEN v_operation.unit = 'squareMeter' AND jsonb_array_length(v_operation.norms) > 0 THEN (
              SELECT coalesce(jsonb_agg(jsonb_build_object('itemId', n.value -> 'itemId',
                'qty', round(public.erp_num(n.value -> 'qtyPerM2', 'qtyPerM2') * v_defect, 3)) ORDER BY n.ord), '[]'::jsonb)
              FROM jsonb_array_elements(v_operation.norms) WITH ORDINALITY AS n(value, ord)
              WHERE EXISTS (SELECT 1 FROM public.erp_items i WHERE i.company_id = v_company AND i.id = public.erp_uuid(n.value -> 'itemId', 'itemId'))
            ) ELSE '[]'::jsonb END);
      END IF;
    WHEN 'purchase.create' THEN
      v_id := public.erp_uuid(p_command -> 'supplierId', 'supplierId');
      IF NOT EXISTS (SELECT 1 FROM public.erp_suppliers WHERE company_id = v_company AND id = v_id) THEN
        RAISE EXCEPTION 'Supplier not found' USING ERRCODE = '22023';
      END IF;
      INSERT INTO public.erp_purchases(company_id, number, supplier_id)
        VALUES (v_company, 'PUR-' || (SELECT lpad((count(*) + 1)::text, greatest(4, length((count(*) + 1)::text)), '0') FROM public.erp_purchases WHERE company_id = v_company), v_id)
        RETURNING id INTO v_entity;
      v_pos := 0;
      FOR v_line IN SELECT value FROM jsonb_array_elements(public.erp_array(p_command -> 'lines', 'lines', true)) LOOP
        v_id := public.erp_uuid(v_line -> 'itemId', 'itemId');
        SELECT * INTO v_item FROM public.erp_items WHERE company_id = v_company AND id = v_id;
        IF NOT FOUND OR v_item.customer_id IS NOT NULL THEN RAISE EXCEPTION 'Purchases require business-owned items' USING ERRCODE = '23514'; END IF;
        INSERT INTO public.erp_purchase_lines(company_id, purchase_id, item_id, position, qty, price)
          VALUES (v_company, v_entity, v_id, v_pos, public.erp_num(v_line -> 'qty', 'purchase qty'), public.erp_money(v_line -> 'price', 'purchase price', true));
        v_pos := v_pos + 1;
      END LOOP;
    WHEN 'purchase.receive' THEN
      v_entity := public.erp_uuid(p_command -> 'purchaseId', 'purchaseId');
      SELECT * INTO v_purchase FROM public.erp_purchases WHERE company_id = v_company AND id = v_entity;
      IF NOT FOUND THEN RAISE EXCEPTION 'Purchase not found' USING ERRCODE = '22023'; END IF;
      v_input := public.erp_array(p_command -> 'lines', 'lines', true);
      IF (SELECT count(*) <> count(DISTINCT public.erp_uuid(value -> 'lineId', 'lineId')) FROM jsonb_array_elements(v_input)) THEN
        RAISE EXCEPTION 'Duplicate receipt line' USING ERRCODE = '22023';
      END IF;
      FOR v_line IN SELECT value FROM jsonb_array_elements(v_input) LOOP
        v_id := public.erp_uuid(v_line -> 'lineId', 'lineId');
        v_qty := public.erp_num(v_line -> 'qty', 'received qty');
        SELECT * INTO v_purchase_line FROM public.erp_purchase_lines WHERE company_id = v_company AND id = v_id AND purchase_id = v_entity;
        IF NOT FOUND THEN RAISE EXCEPTION 'Line does not belong to purchase' USING ERRCODE = '22023'; END IF;
        IF v_qty > v_purchase_line.qty - v_purchase_line.received THEN RAISE EXCEPTION 'Receipt exceeds outstanding quantity' USING ERRCODE = '23514'; END IF;
        SELECT * INTO STRICT v_item FROM public.erp_items WHERE company_id = v_company AND id = v_purchase_line.item_id FOR UPDATE;
        IF v_item.customer_id IS NOT NULL THEN RAISE EXCEPTION 'Cannot purchase customer-owned material' USING ERRCODE = '23514'; END IF;
        v_stock := public.erp_stock_qty(v_company, v_item.id);
        v_cost := round((v_stock * v_item.cost + v_qty * v_purchase_line.price) / (v_stock + v_qty), 2);
        v_new_labor := least(v_cost, round((v_stock * v_item.labor_cost) / (v_stock + v_qty), 2));
        UPDATE public.erp_items SET cost = v_cost, labor_cost = v_new_labor, material_cost = round(v_cost - v_new_labor, 2),
          last_purchase_price = v_purchase_line.price WHERE company_id = v_company AND id = v_item.id;
        UPDATE public.erp_purchase_lines SET received = received + v_qty,
          previous_purchase_price = v_item.last_purchase_price, new_purchase_price = v_purchase_line.price,
          previous_average_cost = v_item.cost, new_average_cost = v_cost WHERE id = v_id;
        INSERT INTO public.erp_stock_movements(company_id, item_id, direction, qty, unit_cost, source, source_id, note)
          VALUES (v_company, v_item.id, 'in', v_qty, v_purchase_line.price, 'purchase', v_entity, 'Purchase receipt');
      END LOOP;
    WHEN 'supplier.pay' THEN
      v_entity := public.erp_uuid(p_command -> 'supplierId', 'supplierId');
      v_amount := public.erp_money(p_command -> 'amount', 'amount');
      v_account := public.erp_account(p_command -> 'account');
      v_allow_prepay := CASE WHEN p_command ? 'allowPrepay' THEN public.erp_bool(p_command -> 'allowPrepay', 'allowPrepay') ELSE false END;
      v_note := coalesce(p_command ->> 'note', '');
      v_kind := coalesce(p_command ->> 'category', 'supplier');
      IF v_kind NOT IN ('supplier', 'outsourcing') THEN
        RAISE EXCEPTION 'Invalid supplier payment category' USING ERRCODE = '22023';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM public.erp_suppliers WHERE company_id = v_company AND id = v_entity) THEN
        RAISE EXCEPTION 'Supplier not found' USING ERRCODE = '22023';
      END IF;
      IF p_command ? 'orderId' AND btrim(p_command ->> 'orderId') <> '' THEN
        v_id := public.erp_uuid(p_command -> 'orderId', 'orderId');
        SELECT * INTO v_order FROM public.erp_orders WHERE company_id = v_company AND id = v_id;
        IF NOT FOUND THEN RAISE EXCEPTION 'Order not found' USING ERRCODE = '22023'; END IF;
        IF v_order.status = 'cancelled' THEN RAISE EXCEPTION 'Cancelled order cannot be paid' USING ERRCODE = '23514'; END IF;
        IF NOT EXISTS (SELECT 1 FROM public.erp_tasks WHERE company_id = v_company AND order_id = v_id
          AND executor_kind = 'supplier' AND supplier_id = v_entity) THEN
          RAISE EXCEPTION 'Supplier is not assigned to this order' USING ERRCODE = '23514';
        END IF;
      END IF;
      v_cap := public.erp_supplier_cost(v_company, v_entity) - public.erp_paid(v_company, 'supplier', v_entity);
      IF NOT v_allow_prepay AND v_amount > v_cap THEN RAISE EXCEPTION 'Payment exceeds payable' USING ERRCODE = '23514'; END IF;
      IF v_amount > public.erp_balance(v_company, v_account) THEN RAISE EXCEPTION 'Insufficient account balance' USING ERRCODE = '23514'; END IF;
      INSERT INTO public.erp_cash(company_id, direction, amount, account, source, source_id, category, note, number)
        VALUES (v_company, 'out', v_amount, v_account, 'supplier', v_entity, v_kind, v_note, public.erp_cash_number(v_company, 'out'));
    WHEN 'payroll.pay' THEN
      v_entity := public.erp_uuid(p_command -> 'employeeId', 'employeeId');
      v_amount := public.erp_money(p_command -> 'amount', 'amount');
      v_account := public.erp_account(p_command -> 'account');
      IF NOT EXISTS (SELECT 1 FROM public.erp_employees WHERE company_id = v_company AND id = v_entity) THEN
        RAISE EXCEPTION 'Employee not found' USING ERRCODE = '22023';
      END IF;
      v_owed := (public.erp_salary_ledger(v_company, v_entity) ->> 'owed')::numeric;
      IF v_amount > v_owed THEN RAISE EXCEPTION 'Payment exceeds payable' USING ERRCODE = '23514'; END IF;
      IF v_amount > public.erp_balance(v_company, v_account) THEN RAISE EXCEPTION 'Insufficient account balance' USING ERRCODE = '23514'; END IF;
      INSERT INTO public.erp_cash(company_id, direction, amount, account, source, source_id, category, note, number)
        VALUES (v_company, 'out', v_amount, v_account, 'payroll', v_entity, 'Payroll payment', '', public.erp_cash_number(v_company, 'out'));
    WHEN 'salary.plan.set' THEN
      v_entity := public.erp_uuid(p_command -> 'employeeId', 'employeeId');
      IF NOT EXISTS (SELECT 1 FROM public.erp_employees WHERE company_id = v_company AND id = v_entity) THEN
        RAISE EXCEPTION 'Employee not found' USING ERRCODE = '22023';
      END IF;
      v_amount := public.erp_money(p_command -> 'amount', 'amount', true);
      IF p_command -> 'mode' IS NOT NULL AND p_command ->> 'mode' <> 'fixed' THEN
        RAISE EXCEPTION 'Workers are paid a fixed monthly salary only' USING ERRCODE = '23514';
      END IF;
      IF (p_command ->> 'fromMonth') IS NULL
        OR (p_command ->> 'fromMonth') !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' THEN
        RAISE EXCEPTION 'Invalid salary plan month' USING ERRCODE = '22023';
      END IF;
      INSERT INTO public.erp_salary_plans(company_id, employee_id, amount, mode, from_month)
        VALUES (v_company, v_entity, v_amount, 'fixed', p_command ->> 'fromMonth')
      ON CONFLICT (company_id, employee_id, from_month) DO UPDATE
        SET amount = EXCLUDED.amount, mode = 'fixed';
    WHEN 'salary.pay' THEN
      v_entity := public.erp_uuid(p_command -> 'employeeId', 'employeeId');
      IF NOT EXISTS (SELECT 1 FROM public.erp_employees WHERE company_id = v_company AND id = v_entity) THEN
        RAISE EXCEPTION 'Employee not found' USING ERRCODE = '22023';
      END IF;
      v_kind := public.erp_text(p_command -> 'kind', 'kind');
      IF v_kind NOT IN ('payroll', 'advance') THEN RAISE EXCEPTION 'Invalid salary payment kind' USING ERRCODE = '22023'; END IF;
      v_note := btrim(public.erp_text(p_command -> 'note', 'note', true));
      IF length(v_note) > 200 THEN RAISE EXCEPTION 'Note is too long' USING ERRCODE = '22023'; END IF;
      v_amount := public.erp_money(p_command -> 'amount', 'amount');
      v_account := public.erp_account(p_command -> 'account');
      v_allow_prepay := public.erp_bool(p_command -> 'allowPrepay', 'allowPrepay');
      v_owed := (public.erp_salary_ledger(v_company, v_entity) ->> 'owed')::numeric;
      IF NOT v_allow_prepay AND v_amount > v_owed THEN RAISE EXCEPTION 'Payment exceeds payable' USING ERRCODE = '23514'; END IF;
      IF v_amount > public.erp_balance(v_company, v_account) THEN RAISE EXCEPTION 'Insufficient account balance' USING ERRCODE = '23514'; END IF;
      INSERT INTO public.erp_cash(company_id, direction, amount, account, source, source_id, category, note, number)
        VALUES (v_company, 'out', v_amount, v_account, 'payroll', v_entity, v_kind, v_note, public.erp_cash_number(v_company, 'out'));
    WHEN 'expense.plan.set' THEN
      IF p_command -> 'planId' IS NOT NULL AND p_command -> 'planId' <> 'null'::jsonb THEN
        v_entity := public.erp_uuid(p_command -> 'planId', 'planId');
      ELSE
        v_entity := gen_random_uuid();
      END IF;
      v_title := btrim(public.erp_text(p_command -> 'title', 'title', true));
      IF v_title = '' OR length(v_title) > 200 THEN RAISE EXCEPTION 'Expense title required' USING ERRCODE = '22023'; END IF;
      v_amount := public.erp_money(p_command -> 'amount', 'amount', true);
      IF (p_command ->> 'fromMonth') IS NULL
        OR (p_command ->> 'fromMonth') !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' THEN
        RAISE EXCEPTION 'Invalid expense plan month' USING ERRCODE = '22023';
      END IF;
      IF (p_command ->> 'dueDay') IS NULL OR (p_command ->> 'dueDay') !~ '^[0-9]+$'
        OR (p_command ->> 'dueDay')::int NOT BETWEEN 1 AND 31 THEN
        RAISE EXCEPTION 'Invalid expense due day' USING ERRCODE = '22023';
      END IF;
      IF p_command -> 'supplierId' IS NOT NULL AND p_command -> 'supplierId' <> 'null'::jsonb THEN
        v_ref := public.erp_uuid(p_command -> 'supplierId', 'supplierId');
        IF NOT EXISTS (SELECT 1 FROM public.erp_suppliers WHERE company_id = v_company AND id = v_ref) THEN
          RAISE EXCEPTION 'Supplier not found' USING ERRCODE = '22023';
        END IF;
      ELSE
        v_ref := NULL;
      END IF;
      INSERT INTO public.erp_expense_plans(company_id, plan_id, title, amount, from_month, due_day, supplier_id)
        VALUES (v_company, v_entity, v_title, v_amount, p_command ->> 'fromMonth', (p_command ->> 'dueDay')::int, v_ref)
      ON CONFLICT (company_id, plan_id, from_month) DO UPDATE
        SET title = EXCLUDED.title, amount = EXCLUDED.amount, due_day = EXCLUDED.due_day, supplier_id = EXCLUDED.supplier_id;
    WHEN 'expense.pay' THEN
      v_entity := public.erp_uuid(p_command -> 'planId', 'planId');
      IF NOT EXISTS (SELECT 1 FROM public.erp_expense_plans WHERE company_id = v_company AND plan_id = v_entity) THEN
        RAISE EXCEPTION 'Expense plan not found' USING ERRCODE = '22023';
      END IF;
      v_note := btrim(public.erp_text(p_command -> 'note', 'note', true));
      IF length(v_note) > 200 THEN RAISE EXCEPTION 'Note is too long' USING ERRCODE = '22023'; END IF;
      v_amount := public.erp_money(p_command -> 'amount', 'amount');
      v_account := public.erp_account(p_command -> 'account');
      v_allow_prepay := public.erp_bool(p_command -> 'allowPrepay', 'allowPrepay');
      v_owed := (public.erp_expense_ledger(v_company, v_entity) ->> 'owed')::numeric;
      IF NOT v_allow_prepay AND v_amount > v_owed THEN RAISE EXCEPTION 'Payment exceeds payable' USING ERRCODE = '23514'; END IF;
      IF v_amount > public.erp_balance(v_company, v_account) THEN RAISE EXCEPTION 'Insufficient account balance' USING ERRCODE = '23514'; END IF;
      INSERT INTO public.erp_cash(company_id, direction, amount, account, source, source_id, category, note, number)
        VALUES (v_company, 'out', v_amount, v_account, 'expense', v_entity, 'expense', v_note, public.erp_cash_number(v_company, 'out'));
    WHEN 'loan.set' THEN
      IF p_command -> 'loanId' IS NOT NULL AND p_command -> 'loanId' <> 'null'::jsonb THEN
        v_entity := public.erp_uuid(p_command -> 'loanId', 'loanId');
      ELSE
        v_entity := gen_random_uuid();
      END IF;
      IF (p_command ->> 'kind') IS NULL OR (p_command ->> 'kind') NOT IN ('loan', 'investment') THEN
        RAISE EXCEPTION 'Invalid loan kind' USING ERRCODE = '22023';
      END IF;
      v_title := btrim(public.erp_text(p_command -> 'title', 'title', true));
      IF v_title = '' OR length(v_title) > 200 THEN RAISE EXCEPTION 'Loan title required' USING ERRCODE = '22023'; END IF;
      v_amount := public.erp_money(p_command -> 'amount', 'amount', true);
      v_note := btrim(public.erp_text(p_command -> 'note', 'note', true));
      IF length(v_note) > 200 THEN RAISE EXCEPTION 'Note is too long' USING ERRCODE = '22023'; END IF;
      INSERT INTO public.erp_loans(company_id, id, title, kind, amount, note)
        VALUES (v_company, v_entity, v_title, p_command ->> 'kind', v_amount, v_note)
        ON CONFLICT (company_id, id) DO UPDATE
          SET title = EXCLUDED.title, kind = EXCLUDED.kind, amount = EXCLUDED.amount, note = EXCLUDED.note;
    WHEN 'loan.draw' THEN
      v_entity := public.erp_uuid(p_command -> 'loanId', 'loanId');
      IF NOT EXISTS (SELECT 1 FROM public.erp_loans WHERE company_id = v_company AND id = v_entity) THEN
        RAISE EXCEPTION 'Loan not found' USING ERRCODE = '22023';
      END IF;
      v_amount := public.erp_money(p_command -> 'amount', 'amount');
      v_note := btrim(public.erp_text(p_command -> 'note', 'note', true));
      IF length(v_note) > 200 THEN RAISE EXCEPTION 'Note is too long' USING ERRCODE = '22023'; END IF;
      v_account := public.erp_account(p_command -> 'account');
      IF v_amount > (public.erp_loan_ledger(v_company, v_entity) ->> 'available')::numeric THEN
        RAISE EXCEPTION 'Amount exceeds loan balance' USING ERRCODE = '23514';
      END IF;
      INSERT INTO public.erp_cash(company_id, direction, amount, account, source, source_id, customer_id, category, note, number)
        VALUES (v_company, 'in', v_amount, v_account, 'loan', v_entity, NULL, 'loan-draw', v_note, public.erp_cash_number(v_company, 'in'));
    WHEN 'loan.repay' THEN
      v_entity := public.erp_uuid(p_command -> 'loanId', 'loanId');
      IF NOT EXISTS (SELECT 1 FROM public.erp_loans WHERE company_id = v_company AND id = v_entity) THEN
        RAISE EXCEPTION 'Loan not found' USING ERRCODE = '22023';
      END IF;
      v_amount := public.erp_money(p_command -> 'amount', 'amount');
      v_note := btrim(public.erp_text(p_command -> 'note', 'note', true));
      IF length(v_note) > 200 THEN RAISE EXCEPTION 'Note is too long' USING ERRCODE = '22023'; END IF;
      v_account := public.erp_account(p_command -> 'account');
      IF v_amount > (public.erp_loan_ledger(v_company, v_entity) ->> 'owed')::numeric THEN
        RAISE EXCEPTION 'Amount exceeds loan debt' USING ERRCODE = '23514';
      END IF;
      IF v_amount > public.erp_balance(v_company, v_account) THEN
        RAISE EXCEPTION 'Insufficient account balance' USING ERRCODE = '23514';
      END IF;
      INSERT INTO public.erp_cash(company_id, direction, amount, account, source, source_id, customer_id, category, note, number)
        VALUES (v_company, 'out', v_amount, v_account, 'loan', v_entity, NULL, 'loan-repay', v_note, public.erp_cash_number(v_company, 'out'));
    WHEN 'routeTemplate.create' THEN
      v_title := btrim(public.erp_text(p_command -> 'name', 'name'));
      v_kind := p_command ->> 'kind';
      IF v_kind NOT IN ('product', 'service') THEN RAISE EXCEPTION 'Invalid order line kind' USING ERRCODE = '22023'; END IF;
      v_stages := public.erp_array(p_command -> 'stages', 'stages', true);
      v_lines := '[]'::jsonb;
      FOR v_line IN SELECT value FROM jsonb_array_elements(v_stages) LOOP
        v_lines := v_lines || jsonb_build_array(public.erp_route_template_stage(v_company, v_line));
      END LOOP;
      v_entity := gen_random_uuid();
      INSERT INTO public.erp_route_templates(company_id, id, name, kind, active, stages)
        VALUES (v_company, v_entity, v_title, v_kind, true, v_lines);
    WHEN 'routeTemplate.update' THEN
      v_entity := public.erp_uuid(p_command -> 'templateId', 'templateId');
      IF NOT EXISTS (SELECT 1 FROM public.erp_route_templates WHERE company_id = v_company AND id = v_entity) THEN
        RAISE EXCEPTION 'Route template not found' USING ERRCODE = '22023';
      END IF;
      v_title := btrim(public.erp_text(p_command -> 'name', 'name'));
      v_kind := p_command ->> 'kind';
      IF v_kind NOT IN ('product', 'service') THEN RAISE EXCEPTION 'Invalid order line kind' USING ERRCODE = '22023'; END IF;
      v_stages := public.erp_array(p_command -> 'stages', 'stages', true);
      v_lines := '[]'::jsonb;
      FOR v_line IN SELECT value FROM jsonb_array_elements(v_stages) LOOP
        v_lines := v_lines || jsonb_build_array(public.erp_route_template_stage(v_company, v_line));
      END LOOP;
      v_active := public.erp_bool(p_command -> 'active', 'active');
      UPDATE public.erp_route_templates
        SET name = v_title, kind = v_kind, active = v_active, stages = v_lines
        WHERE company_id = v_company AND id = v_entity;
    WHEN 'ticket.create' THEN
      v_text := btrim(public.erp_text(p_command -> 'text', 'Ticket text', true));
      IF v_text = '' THEN RAISE EXCEPTION 'Ticket text is required' USING ERRCODE = '22023'; END IF;
      IF length(v_text) > 2000 THEN RAISE EXCEPTION 'Ticket text is too long' USING ERRCODE = '22023'; END IF;
      v_context := public.erp_ticket_context(p_command -> 'context');
      v_author := CASE WHEN v_actor.role = 'worker' THEN v_actor.employee_id ELSE v_actor.id END;
      v_entity := gen_random_uuid();
      INSERT INTO public.erp_support_tickets(company_id, id, author_id, author_name, author_role, status, messages)
        VALUES (v_company, v_entity, v_author, v_actor.name, CASE WHEN v_actor.role = 'admin' THEN 'admin' ELSE 'worker' END, 'open',
          jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'authorId', v_author, 'authorName', v_actor.name,
            'authorRole', CASE WHEN v_actor.role = 'admin' THEN 'admin' ELSE 'worker' END,
            'at', to_char(transaction_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
            'text', v_text, 'context', v_context)));
    WHEN 'ticket.reply' THEN
      v_entity := public.erp_uuid(p_command -> 'ticketId', 'ticketId');
      SELECT * INTO v_ticket FROM public.erp_support_tickets
        WHERE company_id = v_company AND id = v_entity
          AND (v_actor.role = 'admin' OR author_id = v_actor.employee_id)
        FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Ticket not found' USING ERRCODE = '22023'; END IF;
      v_text := btrim(public.erp_text(p_command -> 'text', 'Ticket text', true));
      IF v_text = '' THEN RAISE EXCEPTION 'Ticket text is required' USING ERRCODE = '22023'; END IF;
      IF length(v_text) > 2000 THEN RAISE EXCEPTION 'Ticket text is too long' USING ERRCODE = '22023'; END IF;
      IF jsonb_array_length(v_ticket.messages) >= 200 THEN RAISE EXCEPTION 'Ticket is full' USING ERRCODE = '22023'; END IF;
      v_author := CASE WHEN v_actor.role = 'worker' THEN v_actor.employee_id ELSE v_actor.id END;
      UPDATE public.erp_support_tickets
        SET messages = messages || jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'authorId', v_author,
              'authorName', v_actor.name, 'authorRole', CASE WHEN v_actor.role = 'admin' THEN 'admin' ELSE 'worker' END,
              'at', to_char(transaction_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
              'text', v_text, 'context', NULL)),
            status = 'open', closed_at = NULL, closed_by_name = NULL, updated_at = transaction_timestamp()
        WHERE company_id = v_company AND id = v_entity;
    WHEN 'ticket.close' THEN
      IF v_actor.role <> 'admin' THEN RAISE EXCEPTION 'Administrator action required' USING ERRCODE = '42501'; END IF;
      v_entity := public.erp_uuid(p_command -> 'ticketId', 'ticketId');
      SELECT * INTO v_ticket FROM public.erp_support_tickets WHERE company_id = v_company AND id = v_entity FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Ticket not found' USING ERRCODE = '22023'; END IF;
      IF v_ticket.status = 'open' THEN
        UPDATE public.erp_support_tickets SET status = 'closed', closed_at = transaction_timestamp(), closed_by_name = v_actor.name
          WHERE company_id = v_company AND id = v_entity;
      END IF;
    WHEN 'customer.link' THEN
      v_entity := public.erp_uuid(p_command -> 'customerId', 'customerId');
      IF NOT EXISTS (SELECT 1 FROM public.erp_customers WHERE company_id = v_company AND id = v_entity) THEN
        RAISE EXCEPTION 'Customer not found' USING ERRCODE = '22023';
      END IF;
      IF p_command ? 'employeeId' AND btrim(p_command ->> 'employeeId') <> '' THEN
        v_employee_id := public.erp_uuid(p_command -> 'employeeId', 'employeeId');
        IF NOT EXISTS (SELECT 1 FROM public.erp_employees WHERE company_id = v_company AND id = v_employee_id) THEN
          RAISE EXCEPTION 'Employee not found' USING ERRCODE = '22023';
        END IF;
        IF EXISTS (SELECT 1 FROM public.erp_customers WHERE company_id = v_company AND employee_id = v_employee_id AND id <> v_entity) THEN
          RAISE EXCEPTION 'Employee already has a customer account' USING ERRCODE = '22023';
        END IF;
      ELSE
        v_employee_id := NULL;
      END IF;
      UPDATE public.erp_customers SET employee_id = v_employee_id WHERE company_id = v_company AND id = v_entity;
    WHEN 'salary.deduct' THEN
      v_entity := public.erp_uuid(p_command -> 'employeeId', 'employeeId');
      IF NOT EXISTS (SELECT 1 FROM public.erp_employees WHERE company_id = v_company AND id = v_entity) THEN
        RAISE EXCEPTION 'Employee not found' USING ERRCODE = '22023';
      END IF;
      SELECT id INTO v_customer FROM public.erp_customers WHERE company_id = v_company AND employee_id = v_entity;
      IF v_customer IS NULL THEN RAISE EXCEPTION 'Employee has no customer account' USING ERRCODE = '22023'; END IF;
      v_amount := public.erp_money(p_command -> 'amount', 'amount');
      IF v_amount <= 0 THEN RAISE EXCEPTION 'Amount must be positive' USING ERRCODE = '22023'; END IF;
      IF char_length(coalesce(p_command ->> 'note', '')) > 200 THEN RAISE EXCEPTION 'Note is too long' USING ERRCODE = '22023'; END IF;
      SELECT coalesce(sum(round(l.qty * l.sale_price, 2)), 0) INTO v_shipped
        FROM public.erp_shipments s
        JOIN public.erp_shipment_lines l ON l.company_id = s.company_id AND l.shipment_id = s.id
       WHERE s.company_id = v_company AND s.customer_id = v_customer AND s.status <> 'cancelled';
      SELECT coalesce(sum(CASE direction WHEN 'in' THEN amount WHEN 'out' THEN -amount ELSE 0 END), 0) INTO v_paid_by_cash
        FROM public.erp_cash WHERE company_id = v_company AND source = 'sale' AND customer_id = v_customer;
      SELECT coalesce(sum(CASE WHEN direction = 'deduct' THEN amount ELSE -amount END), 0) INTO v_paid_by_deduct
        FROM public.erp_worker_deductions WHERE company_id = v_company AND customer_id = v_customer;
      IF v_amount > greatest(0, round(v_shipped - v_paid_by_cash - v_paid_by_deduct, 2)) THEN
        RAISE EXCEPTION 'Amount exceeds customer debt' USING ERRCODE = '22023';
      END IF;
      IF v_amount > (public.erp_salary_ledger(v_company, v_entity) ->> 'owed')::numeric THEN
        RAISE EXCEPTION 'Amount exceeds salary debt' USING ERRCODE = '22023';
      END IF;
      INSERT INTO public.erp_worker_deductions(company_id, employee_id, customer_id, amount, direction, note, created_at)
        VALUES (v_company, v_entity, v_customer, v_amount, 'deduct', btrim(coalesce(p_command ->> 'note', '')), CURRENT_TIMESTAMP)
        RETURNING id INTO v_entity;
    WHEN 'salary.deduct.reverse' THEN
      v_entity := public.erp_uuid(p_command -> 'deductionId', 'deductionId');
      SELECT employee_id, customer_id, amount INTO v_employee_id, v_customer, v_amount
        FROM public.erp_worker_deductions
       WHERE company_id = v_company AND id = v_entity AND direction = 'deduct';
      IF NOT FOUND THEN RAISE EXCEPTION 'Deduction not found' USING ERRCODE = '22023'; END IF;
      IF EXISTS (SELECT 1 FROM public.erp_worker_deductions WHERE company_id = v_company AND reversal_of = v_entity) THEN
        RAISE EXCEPTION 'Deduction already reversed' USING ERRCODE = '22023';
      END IF;
      INSERT INTO public.erp_worker_deductions(company_id, employee_id, customer_id, amount, direction, note, reversal_of, created_at)
        VALUES (v_company, v_employee_id, v_customer, v_amount, 'refund', '', v_entity, CURRENT_TIMESTAMP)
        RETURNING id INTO v_entity;
    WHEN 'inventory.count' THEN
      v_entity := public.erp_uuid(p_command -> 'itemId', 'itemId');
      v_qty := public.erp_num(p_command -> 'qty', 'count qty', true);
      SELECT * INTO v_item FROM public.erp_items WHERE company_id = v_company AND id = v_entity;
      IF NOT FOUND THEN RAISE EXCEPTION 'Item not found' USING ERRCODE = '22023'; END IF;
      PERFORM public.erp_text(p_command -> 'note', 'note', true);
      IF v_qty < public.erp_reserved_qty(v_company, v_entity) THEN RAISE EXCEPTION 'Count is below reserved quantity' USING ERRCODE = '23514'; END IF;
      v_stock := public.erp_stock_qty(v_company, v_entity);
      IF v_qty <> v_stock THEN
        INSERT INTO public.erp_stock_movements(company_id, item_id, direction, qty, unit_cost, source, source_id, note)
          VALUES (v_company, v_entity, CASE WHEN v_qty > v_stock THEN 'in' ELSE 'out' END, abs(v_qty - v_stock), v_item.cost, 'inventory', v_entity, p_command ->> 'note');
      END IF;
    WHEN 'cash.post' THEN
      v_direction := public.erp_text(p_command -> 'direction', 'direction');
      IF v_direction NOT IN ('in', 'out', 'transfer') THEN RAISE EXCEPTION 'Invalid cash direction' USING ERRCODE = '22023'; END IF;
      v_amount := public.erp_money(p_command -> 'amount', 'amount');
      v_account := public.erp_account(p_command -> 'account');
      IF NOT (p_command ? 'toAccount') THEN RAISE EXCEPTION 'toAccount is required (account or null)' USING ERRCODE = '22023'; END IF;
      v_to_account := CASE WHEN p_command -> 'toAccount' = 'null'::jsonb THEN NULL ELSE public.erp_account(p_command -> 'toAccount') END;
      IF (v_direction = 'transfer' AND (v_to_account IS NULL OR v_to_account = v_account))
        OR (v_direction <> 'transfer' AND v_to_account IS NOT NULL) THEN RAISE EXCEPTION 'Invalid transfer accounts' USING ERRCODE = '22023'; END IF;
      INSERT INTO public.erp_cash(company_id, direction, amount, account, to_account, source, category, note, number)
        VALUES (v_company, v_direction, v_amount, v_account, v_to_account, CASE WHEN v_direction = 'transfer' THEN 'transfer' ELSE 'manual' END,
          public.erp_text(p_command -> 'category', 'category', true), public.erp_text(p_command -> 'note', 'note', true),
          CASE WHEN v_direction = 'transfer' THEN NULL ELSE public.erp_cash_number(v_company, v_direction) END) RETURNING id INTO v_entity;
    WHEN 'cash.reverse' THEN
      v_id := public.erp_uuid(p_command -> 'entryId', 'entryId');
      SELECT * INTO v_cash FROM public.erp_cash WHERE company_id = v_company AND id = v_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'Cash entry not found' USING ERRCODE = '22023'; END IF;
      IF v_cash.reversal_of IS NOT NULL THEN RAISE EXCEPTION 'Cannot reverse a reversal' USING ERRCODE = '23514'; END IF;
      IF EXISTS (SELECT 1 FROM public.erp_cash WHERE company_id = v_company AND reversal_of = v_id) THEN
        RAISE EXCEPTION 'Cash entry already reversed' USING ERRCODE = '23505';
      END IF;
      IF v_cash.source = 'sale' AND NOT EXISTS (SELECT 1 FROM public.erp_customers WHERE company_id = v_company AND id = v_cash.customer_id)
        OR v_cash.source = 'supplier' AND NOT EXISTS (SELECT 1 FROM public.erp_suppliers WHERE company_id = v_company AND id = v_cash.source_id)
        OR v_cash.source = 'payroll' AND NOT EXISTS (SELECT 1 FROM public.erp_employees WHERE company_id = v_company AND id = v_cash.source_id)
        OR v_cash.source = 'expense' AND NOT EXISTS (SELECT 1 FROM public.erp_expense_plans WHERE company_id = v_company AND plan_id = v_cash.source_id)
        OR v_cash.source = 'loan' AND NOT EXISTS (SELECT 1 FROM public.erp_loans WHERE company_id = v_company AND id = v_cash.source_id) THEN
        RAISE EXCEPTION 'Cash source entity not found' USING ERRCODE = '23514';
      END IF;
      INSERT INTO public.erp_cash(company_id, direction, amount, account, to_account, source, source_id, customer_id, category, note, reversal_of, number)
        VALUES (v_company, CASE v_cash.direction WHEN 'in' THEN 'out' WHEN 'out' THEN 'in' ELSE 'transfer' END,
          v_cash.amount, CASE WHEN v_cash.direction = 'transfer' THEN v_cash.to_account ELSE v_cash.account END,
          CASE WHEN v_cash.direction = 'transfer' THEN v_cash.account ELSE NULL END,
          v_cash.source, v_cash.source_id, v_cash.customer_id, v_cash.category, public.erp_text(p_command -> 'note', 'note', true), v_id,
          CASE WHEN v_cash.direction = 'transfer' THEN NULL ELSE public.erp_cash_number(v_company, CASE v_cash.direction WHEN 'out' THEN 'in' ELSE 'out' END) END) RETURNING id INTO v_entity;
    WHEN 'shipment.create' THEN
      v_id := public.erp_uuid(p_command -> 'orderId', 'orderId');
      SELECT * INTO v_order FROM public.erp_orders WHERE company_id = v_company AND id = v_id FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Order not found' USING ERRCODE = '22023'; END IF;
      -- Command shape is validated before production state is consulted.
      v_line := coalesce(p_command -> 'lines', jsonb_build_array(jsonb_build_object('lineId',
        (SELECT i.id FROM public.erp_order_items i WHERE i.company_id = v_company AND i.order_id = v_id
          ORDER BY i.position LIMIT 1), 'qty', coalesce(p_command -> 'qty', '0'::jsonb))));
      v_lines := (SELECT jsonb_agg(jsonb_build_object('lineId', g.line_id, 'qty', g.qty) ORDER BY g.ord)
        FROM (SELECT public.erp_uuid(l.value -> 'lineId', 'lineId') AS line_id, min(l.ordinality) AS ord,
          round(sum(public.erp_num(l.value -> 'qty', 'shipment qty')), 2) AS qty
          FROM jsonb_array_elements(public.erp_array(v_line, 'lines', true)) WITH ORDINALITY AS l(value, ordinality)
          GROUP BY 1) g);
      v_accept := public.erp_bool(p_command -> 'allowDebt', 'allowDebt');
      IF v_order.kind = 'series' THEN RAISE EXCEPTION 'Stock production is not shipped to a customer' USING ERRCODE = '23514'; END IF;
      IF v_order.customer_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.erp_customers WHERE company_id = v_company AND id = v_order.customer_id) THEN
        RAISE EXCEPTION 'Customer not found' USING ERRCODE = '22023';
      END IF;
      IF v_order.status NOT IN ('production', 'ready', 'shipped') THEN
        RAISE EXCEPTION 'Order is not ready to ship' USING ERRCODE = '23514';
      END IF;
      FOR v_rec IN SELECT l.value AS entry FROM jsonb_array_elements(v_lines) l LOOP
        v_line_id := public.erp_uuid(v_rec.entry -> 'lineId', 'lineId');
        SELECT * INTO v_line_row FROM public.erp_order_items
          WHERE company_id = v_company AND order_id = v_id AND id = v_line_id;
        IF NOT FOUND THEN RAISE EXCEPTION 'Order line not found' USING ERRCODE = '22023'; END IF;
        IF v_line_row.status = 'cancelled' THEN RAISE EXCEPTION 'Cancelled line cannot be shipped' USING ERRCODE = '23514'; END IF;
        IF v_line_row.status NOT IN ('ready', 'shipped') THEN RAISE EXCEPTION 'Order line is not ready to ship' USING ERRCODE = '23514'; END IF;
        IF EXISTS (SELECT 1 FROM public.erp_order_materials WHERE company_id = v_company AND line_id = v_line_id AND issued_qty < qty)
          OR EXISTS (SELECT 1 FROM public.erp_tasks WHERE company_id = v_company AND line_id = v_line_id AND completed < planned) THEN
          RAISE EXCEPTION 'Order production is incomplete' USING ERRCODE = '23514';
        END IF;
        IF public.erp_num(v_rec.entry -> 'qty', 'shipment qty') > v_line_row.qty - public.erp_line_shipped(v_company, v_line_id) THEN
          RAISE EXCEPTION 'Shipment exceeds remaining quantity' USING ERRCODE = '23514';
        END IF;
      END LOOP;
      IF NOT v_accept AND public.erp_order_paid(v_company, v_id) < v_order.price THEN
        RAISE EXCEPTION 'Order debt requires explicit allowDebt' USING ERRCODE = '23514';
      END IF;
      INSERT INTO public.erp_shipments(company_id, order_id, customer_id, kind, address, due_date)
        VALUES (v_company, v_id, v_order.customer_id, 'order', public.erp_text(p_command -> 'address', 'address', true),
          public.erp_date(p_command -> 'dueDate')) RETURNING id INTO v_entity;
      v_pos := 0;
      FOR v_rec IN SELECT l.value AS entry FROM jsonb_array_elements(v_lines) l LOOP
        v_line_id := public.erp_uuid(v_rec.entry -> 'lineId', 'lineId');
        v_qty := public.erp_num(v_rec.entry -> 'qty', 'shipment qty');
        SELECT * INTO STRICT v_line_row FROM public.erp_order_items
          WHERE company_id = v_company AND order_id = v_id AND id = v_line_id;
        SELECT round(coalesce(sum(round(m.issued_qty * m.actual_cost, 2)), 0), 2) INTO v_material_total
          FROM public.erp_order_materials m WHERE m.company_id = v_company AND m.line_id = v_line_id AND m.issued_qty > 0;
        SELECT round(coalesce(sum(p.amount), 0), 2) INTO v_labor_total
          FROM public.erp_payroll p JOIN public.erp_tasks t ON t.company_id = p.company_id AND t.id = p.task_id
          WHERE p.company_id = v_company AND p.order_id = v_id AND p.status = 'accepted' AND t.line_id = v_line_id;
        v_labor_total := round(v_labor_total + coalesce((SELECT sum(CASE WHEN t.supplier_cost > 0 THEN round(t.supplier_cost, 2) ELSE round(t.completed * t.rate, 2) END)
          FROM public.erp_tasks t WHERE t.company_id = v_company AND t.order_id = v_id AND t.line_id = v_line_id
            AND t.executor_kind = 'supplier' AND t.status = 'completed'), 0), 2);
        v_cost_total := round(v_material_total + v_labor_total, 2);
        v_before := public.erp_line_shipped(v_company, v_line_id);
        v_sale_slice := round(v_line_row.total * (v_before + v_qty) / v_line_row.qty, 2)
          - round(v_line_row.total * v_before / v_line_row.qty, 2);
        v_cost_slice := round(v_cost_total * (v_before + v_qty) / v_line_row.qty, 2)
          - round(v_cost_total * v_before / v_line_row.qty, 2);
        v_material_slice := round(v_material_total * (v_before + v_qty) / v_line_row.qty, 2)
          - round(v_material_total * v_before / v_line_row.qty, 2);
        INSERT INTO public.erp_shipment_lines(company_id, shipment_id, position, item_id, line_id, description, qty,
          sale_price, unit_cost, material_cost, labor_cost)
          VALUES (v_company, v_entity, v_pos, NULL, v_line_id, v_order.number || ' · ' || v_line_row.title, v_qty,
            round(v_sale_slice / v_qty, 6), round(v_cost_slice / v_qty, 6),
            round(v_material_slice / v_qty, 6), round((v_cost_slice - v_material_slice) / v_qty, 6));
        UPDATE public.erp_order_items SET status = 'shipped' WHERE company_id = v_company AND id = v_line_id;
        v_pos := v_pos + 1;
      END LOOP;
      PERFORM public.erp_sync_order(v_company, v_id);
    WHEN 'shipment.createStock' THEN
      v_customer := public.erp_uuid(p_command -> 'customerId', 'customerId');
      v_accept := public.erp_bool(p_command -> 'allowDebt', 'allowDebt');
      SELECT * INTO v_customer_row FROM public.erp_customers WHERE company_id = v_company AND id = v_customer;
      IF NOT FOUND THEN RAISE EXCEPTION 'Customer not found' USING ERRCODE = '22023'; END IF;
      IF v_customer_row.kind <> 'shop' THEN RAISE EXCEPTION 'Stock sales require a shop' USING ERRCODE = '23514'; END IF;
      v_input := public.erp_array(p_command -> 'lines', 'lines', true);
      IF jsonb_array_length(v_input) = 0 THEN RAISE EXCEPTION 'Shipment requires lines' USING ERRCODE = '22023'; END IF;
      IF (SELECT count(*) <> count(DISTINCT public.erp_uuid(value -> 'itemId', 'itemId')) FROM jsonb_array_elements(v_input)) THEN
        RAISE EXCEPTION 'Duplicate shipment item' USING ERRCODE = '22023';
      END IF;
      INSERT INTO public.erp_shipments(company_id, customer_id, kind, address, due_date)
        VALUES (v_company, v_customer, 'stock', v_customer_row.address, public.erp_date(p_command -> 'dueDate')) RETURNING id INTO v_entity;
      v_pos := 0;
      v_total := 0;
      FOR v_line IN SELECT value FROM jsonb_array_elements(v_input) LOOP
        v_id := public.erp_uuid(v_line -> 'itemId', 'itemId');
        v_qty := public.erp_num(v_line -> 'qty', 'shipment qty');
        SELECT * INTO v_item FROM public.erp_items WHERE company_id = v_company AND id = v_id;
        IF NOT FOUND THEN RAISE EXCEPTION 'Item not found' USING ERRCODE = '22023'; END IF;
        IF v_item.customer_id IS NOT NULL THEN RAISE EXCEPTION 'Customer materials cannot be sold from stock' USING ERRCODE = '23514'; END IF;
        IF v_item.kind <> 'finished' THEN RAISE EXCEPTION 'Only finished goods can be sold from stock' USING ERRCODE = '23514'; END IF;
        IF v_qty > public.erp_stock_qty(v_company, v_item.id) - public.erp_reserved_qty(v_company, v_item.id) THEN
          RAISE EXCEPTION 'Insufficient stock' USING ERRCODE = '23514';
        END IF;
        INSERT INTO public.erp_shipment_lines(company_id, shipment_id, position, item_id, description, qty,
          sale_price, unit_cost, material_cost, labor_cost)
          VALUES (v_company, v_entity, v_pos, v_item.id, v_item.name, v_qty,
            v_item.sale_price, v_item.cost, v_item.material_cost, v_item.labor_cost);
        INSERT INTO public.erp_stock_movements(company_id, item_id, direction, qty, unit_cost, source, source_id, note)
          VALUES (v_company, v_item.id, 'out', v_qty, v_item.cost, 'sale', v_entity, '');
        v_total := round(v_total + round(v_qty * v_item.sale_price, 2), 2);
        v_pos := v_pos + 1;
      END LOOP;
      IF NOT v_accept AND v_total > public.erp_customer_advance(v_company, v_customer) THEN
        RAISE EXCEPTION 'Unpaid stock shipment' USING ERRCODE = '23514';
      END IF;
    WHEN 'shipment.reverse' THEN
      v_entity := public.erp_uuid(p_command -> 'shipmentId', 'shipmentId');
      SELECT * INTO v_shipment FROM public.erp_shipments WHERE company_id = v_company AND id = v_entity;
      IF NOT FOUND THEN RAISE EXCEPTION 'Shipment not found' USING ERRCODE = '22023'; END IF;
      IF v_shipment.status = 'cancelled' THEN RAISE EXCEPTION 'Shipment already reversed' USING ERRCODE = '23514'; END IF;
      IF v_shipment.kind <> 'stock' THEN RAISE EXCEPTION 'Only stock sales can be reversed' USING ERRCODE = '23514'; END IF;
      FOR v_line IN SELECT jsonb_build_object('itemId', l.item_id, 'qty', l.qty, 'unitCost', l.unit_cost) AS value
        FROM public.erp_shipment_lines l WHERE l.company_id = v_company AND l.shipment_id = v_entity ORDER BY l.position LOOP
        INSERT INTO public.erp_stock_movements(company_id, item_id, direction, qty, unit_cost, source, source_id, note)
          VALUES (v_company, public.erp_uuid(v_line -> 'itemId', 'itemId'), 'in', public.erp_num(v_line -> 'qty', 'qty'),
            public.erp_num(v_line -> 'unitCost', 'unitCost'), 'sale', v_entity, 'Возврат по сторно отгрузки');
      END LOOP;
      UPDATE public.erp_shipments SET status = 'cancelled' WHERE company_id = v_company AND id = v_entity;
    WHEN 'shipment.deliver' THEN
      v_entity := public.erp_uuid(p_command -> 'shipmentId', 'shipmentId');
      SELECT * INTO v_shipment FROM public.erp_shipments WHERE company_id = v_company AND id = v_entity FOR UPDATE;
      IF NOT FOUND OR v_shipment.status <> 'shipped' THEN RAISE EXCEPTION 'Undelivered shipment required' USING ERRCODE = '23514'; END IF;
      IF v_shipment.kind = 'order' THEN
        SELECT * INTO STRICT v_order FROM public.erp_orders WHERE company_id = v_company AND id = v_shipment.order_id FOR UPDATE;
        IF v_order.status NOT IN ('production', 'ready', 'shipped') THEN RAISE EXCEPTION 'Order is not shipped' USING ERRCODE = '23514'; END IF;
      END IF;
      UPDATE public.erp_shipments SET status = 'delivered', delivered_at = transaction_timestamp() WHERE id = v_entity;
      IF v_shipment.kind = 'order' THEN
        UPDATE public.erp_order_items SET status = 'delivered'
          WHERE company_id = v_company AND order_id = v_order.id AND status = 'shipped'
            AND qty <= public.erp_line_shipped(v_company, id, true);
        PERFORM public.erp_sync_order(v_company, v_order.id);
      END IF;
    ELSE
      RAISE EXCEPTION 'Unsupported command: %', v_type USING ERRCODE = '22023';
  END CASE;

  PERFORM public.erp_assert_stock(v_company);
  PERFORM public.erp_assert_cash(v_company);
  UPDATE public.erp_metadata SET revision = revision + 1 WHERE company_id = v_company;
  INSERT INTO public.erp_audit(company_id, request_id, actor_user_id, actor_id, actor_name, action, entity_id, command, expected_revision, revision)
    VALUES (v_company, p_request_id, v_actor.id, CASE WHEN v_actor.role = 'worker' THEN v_actor.employee_id ELSE v_actor.id END,
      v_actor.name, v_type, v_entity::text, p_command, p_expected_revision, v_revision + 1);
  RETURN public.erp_snapshot();
END;
$$;

-- Helpers are not API write paths, and signup metadata never supplies a role.
REVOKE ALL ON FUNCTION
  public.erp_num(jsonb, text, boolean), public.erp_money(jsonb, text, boolean), public.erp_signed_money(jsonb, text), public.erp_uuid(jsonb, text), public.erp_text(jsonb, text, boolean),
  public.erp_bool(jsonb, text), public.erp_account(jsonb), public.erp_date(jsonb), public.erp_array(jsonb, text, boolean), public.erp_unit(jsonb), public.erp_ticket_context(jsonb),
  public.erp_current_profile(), public.erp_current_company_id(), public.erp_is_admin(),
  public.erp_stock_qty(uuid, uuid), public.erp_reserved_qty(uuid, uuid, uuid), public.erp_balance(uuid, text), public.erp_paid(uuid, text, uuid),
  public.erp_salary_ledger(uuid, uuid, date), public.erp_expense_ledger(uuid, uuid, date), public.erp_loan_ledger(uuid, uuid), public.erp_customer_advance(uuid, uuid), public.erp_order_paid(uuid, uuid),
  public.erp_supplier_cost(uuid, uuid), public.erp_ready(uuid, uuid), public.erp_work_task(uuid, public.erp_profiles, uuid, uuid),
  public.erp_insert_components(uuid, uuid, jsonb), public.erp_assert_recipes(uuid), public.erp_insert_route(uuid, uuid, uuid, numeric, jsonb),
  public.erp_insert_materials(uuid, uuid, uuid, uuid, jsonb), public.erp_revise_materials(uuid, uuid, uuid, uuid, jsonb, integer),
  public.erp_norm_delta(uuid, uuid, uuid, uuid, jsonb, jsonb),
  public.erp_norms(uuid, jsonb), public.erp_insert_norm_materials(uuid, uuid, uuid), public.erp_route_template_stage(uuid, jsonb),
  public.erp_revise_route(uuid, uuid, uuid, numeric, jsonb, integer), public.erp_task_started(uuid, uuid, uuid),
  public.erp_sync_identity(uuid, uuid), public.erp_sync_order(uuid, uuid), public.erp_line_shipped(uuid, uuid, boolean),
  public.erp_assert_cash(uuid), public.erp_assert_stock(uuid),
  public.erp_snapshot(), public.erp_bootstrap_company(text), public.erp_link_worker(uuid, uuid), public.erp_link_display(uuid, text), public.erp_execute(uuid, bigint, jsonb)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.erp_current_company_id(), public.erp_is_admin(), public.erp_snapshot(), public.erp_bootstrap_company(text),
  public.erp_link_worker(uuid, uuid), public.erp_link_display(uuid, text), public.erp_execute(uuid, bigint, jsonb),
  public.erp_salary_ledger(uuid, uuid, date), public.erp_expense_ledger(uuid, uuid, date), public.erp_loan_ledger(uuid, uuid) TO authenticated;

COMMIT;
