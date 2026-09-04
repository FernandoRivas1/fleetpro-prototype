// Base URL for the FastAPI backend. Defaults to the backend's own default
// dev port so `npm run dev` works with zero config; override via
// VITE_API_BASE_URL (see .env.example) for any other setup.
export const API_BASE_URL: string =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? 'http://localhost:8000';

/** Same origin as API_BASE_URL, but ws(s):// instead of http(s):// — used
 * to open the checkout WebSocket (see app/checkout/ws.py).
 *
 * Deliberately keyed off the *page's own* protocol, not whatever scheme
 * happens to be baked into VITE_API_BASE_URL: a page served over https
 * MUST use wss (browsers silently block a plain ws:// connection from an
 * https:// page as mixed content — it fails with no visible error, not
 * even in the network tab in some browsers). If VITE_API_BASE_URL were
 * ever misconfigured as "http://..." in production, deriving from its
 * scheme instead would silently produce ws:// and break exactly this way
 * — works locally over http, breaks once deployed over https. */
const isSecurePage = typeof window !== 'undefined' && window.location.protocol === 'https:';
export const WS_BASE_URL: string = API_BASE_URL.replace(/^https?/, isSecurePage ? 'wss' : 'ws');

export class ApiError extends Error {
  status: number;
  detail: unknown;

  constructor(status: number, detail: unknown) {
    super(typeof detail === 'string' ? detail : `Request failed with status ${status}`);
    this.status = status;
    this.detail = detail;
  }
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail: unknown;
    try {
      detail = (await res.json()).detail;
    } catch {
      detail = await res.text().catch(() => undefined);
    }
    throw new ApiError(res.status, detail);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });
  return handleResponse<T>(res);
}

/** For multipart/form-data bodies (file uploads) — no Content-Type header,
 * so the browser sets it (with the correct boundary) itself. */
async function apiFetchForm<T>(path: string, formData: FormData): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, { method: 'POST', body: formData });
  return handleResponse<T>(res);
}

// --- Stations (app/checkout/stations.py) -----------------------------------

export interface StationCreateResponse {
  station_id: string;
  pairing_token: string;
  pin: string;
  pin_expires_in_seconds: number;
  qr_url: string;
}

export interface StationRead {
  id: string;
  branch_id: string;
  label: string;
  active_contract_id: string | null;
  paired_at: string | null;
  last_seen_at: string | null;
}

export interface StationPairResponse {
  station_id: string;
  pairing_token: string;
}

export function createStation(branchId: string, label: string): Promise<StationCreateResponse> {
  return apiFetch('/api/v1/stations', {
    method: 'POST',
    body: JSON.stringify({ branch_id: branchId, label }),
  });
}

export function getStation(stationId: string): Promise<StationRead> {
  return apiFetch(`/api/v1/stations/${stationId}`);
}

export function pairStationWithPin(pin: string): Promise<StationPairResponse> {
  return apiFetch('/api/v1/stations/pair', {
    method: 'POST',
    body: JSON.stringify({ pin }),
  });
}

export function pairStationWithCredentials(
  stationId: string,
  pairingToken: string,
): Promise<StationPairResponse> {
  return apiFetch('/api/v1/stations/pair', {
    method: 'POST',
    body: JSON.stringify({ station_id: stationId, pairing_token: pairingToken }),
  });
}

export function unlinkStation(stationId: string): Promise<StationPairResponse> {
  return apiFetch(`/api/v1/stations/${stationId}/unlink`, { method: 'POST' });
}

// --- Branches (app/shared/branches.py) --------------------------------------

export interface BranchRead {
  id: string;
  name: string;
  code: string;
  address: string | null;
}

export function listBranches(): Promise<BranchRead[]> {
  return apiFetch('/api/v1/branches');
}

function qs(params: Record<string, string | undefined>): string {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined) usp.set(k, v);
  const s = usp.toString();
  return s ? `?${s}` : '';
}

// --- Reservations (app/checkout/reservations.py) ----------------------------

export interface ReservationRead {
  id: string;
  code: string;
  driver_first_name: string;
  driver_last_name: string;
  driver_email: string;
  pickup_date: string;
  return_date: string;
  pickup_branch_id: string;
  acriss_category_id: string;
  deposit_done_online: boolean;
  status: 'pending' | 'confirmed' | 'cancelled' | 'completed' | 'no_show';
  /** null if no Driver row exists yet for this email — see schemas.py. */
  driver_tier: CustomerTier | null;
}

export function listReservations(branchId: string): Promise<ReservationRead[]> {
  return apiFetch(`/api/v1/checkout/reservations${qs({ branch_id: branchId })}`);
}

// --- Pre Check-in — executive review queue (app/checkout/precheckin.py) ----

export type PrecheckinStatus = 'requested' | 'loaded' | 'confirmed';

export interface PrecheckinRead {
  status: PrecheckinStatus;
  contact_email: string;
  requested_at: string | null;
  reminder_count: number;
  loaded_at: string | null;
  confirmed_at: string | null;
  national_id_or_passport: string | null;
  phone: string | null;
  license_number: string | null;
  license_expiration: string | null;
  id_photo_url: string | null;
  license_photo_url: string | null;
  unskip: boolean;
}

export interface PrecheckinQueueItem {
  reservation: ReservationRead;
  /** null means "not requested yet" — see PrecheckinStatus. */
  precheckin: PrecheckinRead | null;
}

export function listPrecheckinQueue(branchId: string, withinHours?: number): Promise<PrecheckinQueueItem[]> {
  return apiFetch(
    `/api/v1/checkout/precheckin${qs({
      branch_id: branchId,
      within_hours: withinHours !== undefined ? String(withinHours) : undefined,
    })}`,
  );
}

export interface PrecheckinRequestResponse {
  reservation_id: string;
  precheckin: PrecheckinRead;
  /** No mail provider is wired up for this prototype — the executive
   * copies/sends this link themselves. See precheckin.py's module docstring. */
  portal_url: string;
}

export function requestPrecheckin(reservationId: string, email: string): Promise<PrecheckinRequestResponse> {
  return apiFetch(`/api/v1/checkout/precheckin/${reservationId}/request`, {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
}

export function remindPrecheckin(reservationId: string): Promise<PrecheckinRead> {
  return apiFetch(`/api/v1/checkout/precheckin/${reservationId}/remind`, { method: 'POST' });
}

export function confirmPrecheckin(reservationId: string): Promise<PrecheckinRead> {
  return apiFetch(`/api/v1/checkout/precheckin/${reservationId}/confirm`, { method: 'POST' });
}

export function setPrecheckinUnskip(reservationId: string, unskip: boolean): Promise<PrecheckinRead> {
  return apiFetch(`/api/v1/checkout/precheckin/${reservationId}/unskip`, {
    method: 'POST',
    body: JSON.stringify({ unskip }),
  });
}

// --- Pre Check-in — public driver portal (app/checkout/precheckin.py) ------
//
// No auth beyond reservation code + last name (see the backend's STUB
// comments) — reached directly by the driver's own phone/laptop, not
// behind station pairing.

export interface PrecheckinLookupResponse {
  reservation_id: string;
  code: string;
  driver_first_name: string;
  driver_last_name: string;
  pickup_date: string;
  return_date: string;
  acriss_category_id: string;
  /** null means nothing has been submitted for this reservation yet. */
  status: PrecheckinStatus | null;
  national_id_or_passport: string | null;
  phone: string | null;
  license_number: string | null;
  license_expiration: string | null;
}

export function lookupPrecheckin(code: string, lastName: string): Promise<PrecheckinLookupResponse> {
  return apiFetch('/api/v1/precheckin/lookup', {
    method: 'POST',
    body: JSON.stringify({ code, last_name: lastName }),
  });
}

export interface PrecheckinSubmitRequest {
  code: string;
  last_name: string;
  national_id_or_passport: string;
  phone: string;
  license_number: string;
  license_expiration: string; // YYYY-MM-DD
}

export function submitPrecheckin(reservationId: string, body: PrecheckinSubmitRequest): Promise<PrecheckinRead> {
  return apiFetch(`/api/v1/precheckin/${reservationId}/submit`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function scanPrecheckinDocument(
  reservationId: string,
  code: string,
  lastName: string,
  type: DocumentType,
  image: File,
): Promise<ScanDocumentResponse> {
  const form = new FormData();
  form.set('code', code);
  form.set('last_name', lastName);
  form.set('type', type);
  form.set('image', image);
  return apiFetchForm(`/api/v1/precheckin/${reservationId}/scan-document`, form);
}

// --- Drivers (app/checkout/drivers.py) --------------------------------------

export type CustomerTier = 'Standard' | 'Silver' | 'Gold' | 'Corporate';

export interface DriverRead {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  national_id_or_passport: string | null;
  phone: string | null;
  license_number: string | null;
  license_expiration: string | null;
  id_photo_url: string | null;
  license_photo_url: string | null;
  documents_verified: boolean;
  preferred_color: string | null;
  preferred_transmission: 'manual' | 'automatic' | null;
  last_visit_date: string | null;
  tier: CustomerTier;
}

/** Resolves to null (not a thrown error) on a 404 — "no driver on file" is
 * an expected, common outcome here, not a failure. */
export async function getDriverByEmail(email: string): Promise<DriverRead | null> {
  try {
    return await apiFetch(`/api/v1/checkout/drivers/by-email${qs({ email })}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

// --- Customer loyalty tiers (app/checkout/tiers.py) -------------------------

export interface TierCondition {
  text: string;
  value: string;
}

export interface TierInfo {
  tier: CustomerTier;
  conditions: TierCondition[];
}

export function listTiers(): Promise<TierInfo[]> {
  return apiFetch('/api/v1/checkout/tiers');
}

// --- Fleet: categories + candidates (app/fleet/*.py) ------------------------

export interface ACRISSFeatures {
  transmission: 'manual' | 'automatic';
  air_conditioning: boolean;
  bluetooth: boolean;
  passenger_capacity: number;
  trunk_capacity_l: number;
}

export interface ACRISSCategoryRead {
  id: string;
  code: string;
  name: string;
  hierarchy_order: number;
  base_daily_rate: number;
  features: ACRISSFeatures;
}

export interface VehicleRead {
  id: string;
  plate: string;
  make: string;
  model: string;
  year: number;
  acriss_category_id: string;
  branch_id: string;
  status: 'Available' | 'Rented' | 'InPrep' | 'Inactive';
  current_km: number;
  next_service_km: number;
  damage_count: number;
  main_photo_url: string | null;
}

export interface ScoreBreakdown {
  transmission_match: number;
  low_mileage: number;
  service_headroom: number;
  damage_penalty: number;
}

export interface CandidateVehicle {
  vehicle: VehicleRead;
  score: number;
  score_breakdown: ScoreBreakdown;
}

export interface CandidatesResponse {
  category_id: string;
  branch_id: string;
  driver_id: string;
  candidates: CandidateVehicle[];
}

export function listAcrissCategories(): Promise<ACRISSCategoryRead[]> {
  return apiFetch('/api/v1/fleet/categories');
}

export function getCandidates(categoryId: string, branchId: string, driverId: string): Promise<CandidatesResponse> {
  return apiFetch(
    `/api/v1/fleet/candidates${qs({ category_id: categoryId, branch_id: branchId, driver_id: driverId })}`,
  );
}

// --- Checkout (app/checkout/checkout.py, flow.py) ---------------------------

export interface CheckoutStartResponse {
  contract_id: string;
  driver_id: string;
  origin: 'from_reservation' | 'walk_in';
  skip_document_scan: boolean;
  skip_driver_data: boolean;
}

export function startCheckoutFromReservation(stationId: string, reservationId: string): Promise<CheckoutStartResponse> {
  return apiFetch('/api/v1/checkout/start', {
    method: 'POST',
    body: JSON.stringify({ station_id: stationId, reservation_id: reservationId }),
  });
}

export function startWalkInCheckout(
  stationId: string,
  firstName: string,
  lastName: string,
  email?: string,
  /** Multi-branch switching (Executive Main design) — omit to use the
   * station's own default branch. */
  branchId?: string,
): Promise<CheckoutStartResponse> {
  return apiFetch('/api/v1/checkout/start', {
    method: 'POST',
    body: JSON.stringify({
      station_id: stationId,
      first_name: firstName,
      last_name: lastName,
      email,
      branch_id: branchId,
    }),
  });
}

export interface CheckoutDriverSummary {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  national_id_or_passport: string | null;
  license_number: string | null;
  documents_verified: boolean;
  license_expiration: string | null;
  ready_for_checkout: boolean;
  tier: CustomerTier;
}

export type CheckoutStep =
  | 'rental_details'
  | 'document_verification'
  | 'vehicle_selection'
  | 'extras_and_deposit'
  | 'awaiting_signature'
  | 'awaiting_handover'
  | 'completed';

export interface CheckoutStatusResponse {
  contract_id: string;
  status: 'New' | 'PreOpened' | 'Open';
  origin: 'from_reservation' | 'walk_in';
  current_step: CheckoutStep;
  station_id: string;
  branch_id: string;
  reservation_id: string | null;
  opened_at: string | null;
  driver: CheckoutDriverSummary;
  vehicle: VehicleRead | null;
  current_category: ACRISSCategoryRead | null;
  extras: ContractExtraRead[];
  deposit: DepositRead | null;
  signatures: { id: string; contract_id: string; type: 'contract' | 'handover_report'; timestamp: string }[];
  skip_driver_data: boolean;
  rental_details_confirmed: boolean;
}

export function getCheckoutStatus(contractId: string): Promise<CheckoutStatusResponse> {
  return apiFetch(`/api/v1/checkout/${contractId}/status`);
}

// --- rental-details (app/checkout/flow.py) ----------------------------------
// Step 1 of the wizard (Tablet Rental Details design) — see the backend
// module's own comment for why a from_reservation contract's edits land
// on the Reservation row while a walk-in's land on the contract itself;
// this response always reflects the resolved, either-way values.

export interface RentalDetailsResponse {
  contract_id: string;
  origin: 'from_reservation' | 'walk_in';
  confirmed: boolean;
  /** False once a vehicle has been selected — nothing here can change
   * out from under the candidate list it was drawn from. */
  editable: boolean;
  reservation_code: string | null;
  pickup_branch: BranchRead;
  return_branch: BranchRead;
  pickup_date: string;
  return_date: string;
  /** Null only for a walk-in that hasn't picked a category yet. */
  category: ACRISSCategoryRead | null;
}

export interface RentalDetailsUpdateRequest {
  pickup_branch_id: string;
  return_branch_id: string;
  pickup_date: string;
  return_date: string;
  acriss_category_id: string;
}

export function getRentalDetails(contractId: string): Promise<RentalDetailsResponse> {
  return apiFetch(`/api/v1/checkout/${contractId}/rental-details`);
}

export function confirmRentalDetails(
  contractId: string,
  body: RentalDetailsUpdateRequest,
): Promise<RentalDetailsResponse> {
  return apiFetch(`/api/v1/checkout/${contractId}/rental-details`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export interface ConfirmDocumentsRequest {
  first_name: string;
  last_name: string;
  national_id_or_passport: string;
  license_number: string;
  license_expiration: string; // YYYY-MM-DD
}

export interface ConfirmDocumentsResponse {
  contract_id: string;
  driver_id: string;
  documents_verified: boolean;
  license_expiration: string;
}

export function confirmDocuments(contractId: string, body: ConfirmDocumentsRequest): Promise<ConfirmDocumentsResponse> {
  return apiFetch(`/api/v1/checkout/${contractId}/confirm-documents`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export interface UpsellSuggestionResponse {
  has_suggestion: boolean;
  reason: string | null;
  current_category: ACRISSCategoryRead | null;
  suggested_category: ACRISSCategoryRead | null;
  vehicle: VehicleRead | null;
  daily_price_difference: number | null;
}

export function getUpsellSuggestion(contractId: string): Promise<UpsellSuggestionResponse> {
  return apiFetch(`/api/v1/checkout/${contractId}/upsell-suggestion`);
}

// --- Extras catalog (app/shared/extras.py) ----------------------------------

export interface ExtraRead {
  id: string;
  name: string;
  description: string | null;
  default_price: number;
}

export function listExtras(): Promise<ExtraRead[]> {
  return apiFetch('/api/v1/extras');
}

// --- confirm-driver-data (app/checkout/flow.py) -----------------------------

export interface ConfirmDriverDataRequest {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
}

export interface ConfirmDriverDataResponse {
  contract_id: string;
  driver_id: string;
  email: string;
}

export function confirmDriverData(
  contractId: string,
  body: ConfirmDriverDataRequest,
): Promise<ConfirmDriverDataResponse> {
  return apiFetch(`/api/v1/checkout/${contractId}/confirm-driver-data`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

// --- scan-document (app/checkout/documents.py) ------------------------------

export type DocumentType = 'id' | 'license';

export interface ScanDocumentResponse {
  success: boolean;
  document_type: DocumentType;
  photo_url: string | null;
  data: Record<string, string | null> | null;
  valid: boolean;
  error: string | null;
}

export function scanDocument(contractId: string, type: DocumentType, image: File): Promise<ScanDocumentResponse> {
  const form = new FormData();
  form.set('type', type);
  form.set('image', image);
  return apiFetchForm(`/api/v1/checkout/${contractId}/scan-document`, form);
}

export interface DocumentScanModeResponse {
  skip_document_ocr: boolean;
}

/** TEMPORARY — mirrors the backend's skip_document_ocr switch (see
 * app/config.py), so a document-capture screen knows whether OCR is
 * currently mocked and can skip requiring an actual photo. */
export function getDocumentScanMode(): Promise<DocumentScanModeResponse> {
  return apiFetch(`/api/v1/checkout/document-scan-mode`);
}

// --- select-vehicle (app/checkout/flow.py) ----------------------------------

export interface SelectVehicleResponse {
  contract_id: string;
  vehicle_id: string;
  status: 'New' | 'PreOpened' | 'Open';
}

export function selectVehicle(contractId: string, vehicleId: string): Promise<SelectVehicleResponse> {
  return apiFetch(`/api/v1/checkout/${contractId}/select-vehicle`, {
    method: 'POST',
    body: JSON.stringify({ vehicle_id: vehicleId }),
  });
}

// --- extras line items (app/checkout/flow.py) -------------------------------

export interface ContractExtraRead {
  id: string;
  contract_id: string;
  extra_id: string;
  quantity: number;
  applied_price: number;
}

export interface SetExtrasResponse {
  contract_id: string;
  extras: ContractExtraRead[];
  total_amount: number;
}

export function setExtras(
  contractId: string,
  items: { extra_id: string; quantity: number }[],
): Promise<SetExtrasResponse> {
  return apiFetch(`/api/v1/checkout/${contractId}/extras`, {
    method: 'POST',
    body: JSON.stringify({ extras: items }),
  });
}

// --- deposit (app/checkout/flow.py) -----------------------------------------

export interface DepositRead {
  id: string;
  contract_id: string;
  amount: number;
  mechanism: 'online_in_advance' | 'in_person' | 'waived';
  status: 'pending' | 'authorized';
  authorized_at: string | null;
}

export interface DepositStatusResponse {
  authorized: boolean;
  requires_in_person_authorization: boolean;
  deposit: DepositRead | null;
  message: string | null;
}

export function getDeposit(contractId: string): Promise<DepositStatusResponse> {
  return apiFetch(`/api/v1/checkout/${contractId}/deposit`);
}

export function authorizeDeposit(contractId: string): Promise<DepositRead> {
  return apiFetch(`/api/v1/checkout/${contractId}/deposit/authorize`, { method: 'POST' });
}

// --- sign (app/checkout/flow.py) --------------------------------------------

export interface SignContractResponse {
  contract_id: string;
  status: 'New' | 'PreOpened' | 'Open';
  opened_at: string;
  signature_id: string;
}

export function signContract(contractId: string, signatureImageBase64: string): Promise<SignContractResponse> {
  return apiFetch(`/api/v1/checkout/${contractId}/sign`, {
    method: 'POST',
    body: JSON.stringify({ signature_image_base64: signatureImageBase64 }),
  });
}

// --- resolve-handover (app/reports/handover.py) -----------------------------

export interface ResolveHandoverResponse {
  type: 'pre_report' | 'new_report';
  url: string;
}

export function resolveHandover(contractId: string): Promise<ResolveHandoverResponse> {
  return apiFetch(`/api/v1/checkout/${contractId}/resolve-handover`, { method: 'POST' });
}

// --- Pre-handover report (app/reports/pre_handover.py) — public, no auth ----

export interface PublicVehicleSummary {
  plate: string;
  make: string;
  model: string;
  year: number;
  main_photo_url: string | null;
}

export interface PreHandoverReportPublicView {
  id: string;
  vehicle: PublicVehicleSummary | null;
  photos: string[];
  damage_diagram: {
    scratches?: { panel: string; severity: string }[];
    dents?: { panel: string; severity: string }[];
    notes?: string;
    client_comments?: { id: string; note: string | null; photo_url: string | null; created_at: string }[];
    [key: string]: unknown;
  };
  created_at: string;
}

export function getPreHandoverReport(preReportId: string): Promise<PreHandoverReportPublicView> {
  return apiFetch(`/api/v1/reports/pre/${preReportId}`);
}

export interface AddCommentResponse {
  id: string;
  note: string | null;
  photo_url: string | null;
  created_at: string;
}

export function addPreHandoverComment(
  preReportId: string,
  note: string | undefined,
  photo: File | undefined,
): Promise<AddCommentResponse> {
  const form = new FormData();
  if (note) form.set('note', note);
  if (photo) form.set('photo', photo);
  return apiFetchForm(`/api/v1/reports/pre/${preReportId}/comment`, form);
}

// --- New handover report (app/reports/handover.py) — public, no auth -------

export interface HandoverReportRead {
  id: string;
  contract_id: string;
  pre_handover_report_id: string | null;
  photos: string[];
  damage_diagram: Record<string, unknown>;
  delivery_km: number | null;
  delivery_fuel_level: string | null;
  signature_id: string | null;
  pdf_url: string | null;
  status: 'pending' | 'completed';
  date: string;
}

export interface NewHandoverReportView {
  contract_id: string;
  handover_report: HandoverReportRead;
  driver_name: string;
  vehicle: VehicleRead | null;
}

export function getNewHandoverReport(contractId: string): Promise<NewHandoverReportView> {
  return apiFetch(`/api/v1/reports/new/${contractId}`);
}

export interface CompleteHandoverResponse {
  contract_id: string;
  handover_report_id: string;
  status: 'pending' | 'completed';
  pdf_url: string;
}

export function completeHandoverReport(
  contractId: string,
  body: {
    deliveryKm: number;
    deliveryFuelLevel: string;
    signatureImageBase64: string;
    damageDiagram?: Record<string, unknown>;
    photos: File[];
  },
): Promise<CompleteHandoverResponse> {
  const form = new FormData();
  form.set('delivery_km', String(body.deliveryKm));
  form.set('delivery_fuel_level', body.deliveryFuelLevel);
  form.set('signature_image_base64', body.signatureImageBase64);
  if (body.damageDiagram) form.set('damage_diagram_json', JSON.stringify(body.damageDiagram));
  for (const photo of body.photos) form.append('photos', photo);
  return apiFetchForm(`/api/v1/reports/new/${contractId}/complete`, form);
}
