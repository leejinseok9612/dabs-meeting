export type MeetingStatus    = 'open' | 'closed'
export type SubmissionStatus = 'pending' | 'submitted' | 'rejected'

export interface Meeting {
  id:           string
  title:        string
  date:         string
  description?: string
  status:       MeetingStatus
  created_by:   string
  created_at:   string
}

export interface Team {
  id:             string
  name:           string
  department?:    string
  contact_email?: string
}

export interface Submission {
  id:               string
  meeting_id:       string
  team_id:          string
  order_index:      number
  file_path?:       string
  file_name?:       string
  file_size?:       number
  personnel_count?: number
  equipment?:       string
  work_location?:   string
  status:           SubmissionStatus
  submitted_at?:    string
  note?:            string
  teams?:           Team
}

export interface MergedPdf {
  id:         string
  meeting_id: string
  file_path:  string
  created_at: string
}
