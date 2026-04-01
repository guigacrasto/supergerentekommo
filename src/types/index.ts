export interface KommoConfig {
    subdomain: string;
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    accessToken?: string;
}

export interface Lead {
    id: number;
    name: string;
    price: number;
    responsible_user_id: number;
    group_id: number;
    status_id: number;
    pipeline_id: number;
    loss_reason_id: number;
    created_by: number;
    updated_by: number;
    created_at: number;
    updated_at: number;
    status_changed_at: number;
    closed_at: number;
    closest_task_at: number;
    is_deleted: boolean;
    custom_fields_values: any[] | null;
    score: number | null;
    account_id: number;
    _embedded: {
        tags: any[];
        loss_reason?: any[];
        companies?: any[];
        contacts?: any[];
    };
}

export interface Message {
    id: string;
    entity_id: number;
    entity_type: string;
    chat_id: string;
    message_id: string;
    type: string;
    text: string;
    created_at: number;
    author_id: number;
    is_incoming: boolean;
}

// Multi-tenant types
export interface Tenant {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  primaryColor: string;
  kommoBaseUrl: string | null;
  kommoAccessToken: string | null;
  kommoRefreshToken: string | null;
  kommoTokenExpiresAt: string | null;
  webhookSecret: string | null;
  settings: TenantSettings;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TenantSettings {
  teams?: Record<string, TenantTeamConfig>;
  hotLeadStatuses?: number[];
  [key: string]: unknown;
}

export interface TenantTeamConfig {
  label: string;
  subdomain: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  excludePipelineNames?: string[];
}
