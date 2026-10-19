CREATE OR REPLACE FUNCTION ops.prevent_funding_history_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Funding-cycle history is retained. Archive funding requests through the application instead of deleting or truncating history.'
    USING ERRCODE = 'restrict_violation';
END;
$$;

DROP TRIGGER IF EXISTS prevent_funding_request_delete ON ops."FundingRequest";
CREATE TRIGGER prevent_funding_request_delete
BEFORE DELETE ON ops."FundingRequest"
FOR EACH ROW
EXECUTE FUNCTION ops.prevent_funding_history_delete();

DROP TRIGGER IF EXISTS prevent_funding_request_truncate ON ops."FundingRequest";
CREATE TRIGGER prevent_funding_request_truncate
BEFORE TRUNCATE ON ops."FundingRequest"
FOR EACH STATEMENT
EXECUTE FUNCTION ops.prevent_funding_history_delete();

DROP TRIGGER IF EXISTS prevent_work_submission_delete ON ops."WorkSubmission";
CREATE TRIGGER prevent_work_submission_delete
BEFORE DELETE ON ops."WorkSubmission"
FOR EACH ROW
EXECUTE FUNCTION ops.prevent_funding_history_delete();

DROP TRIGGER IF EXISTS prevent_work_submission_truncate ON ops."WorkSubmission";
CREATE TRIGGER prevent_work_submission_truncate
BEFORE TRUNCATE ON ops."WorkSubmission"
FOR EACH STATEMENT
EXECUTE FUNCTION ops.prevent_funding_history_delete();

DROP TRIGGER IF EXISTS prevent_funding_report_delete ON ops."FundingReport";
CREATE TRIGGER prevent_funding_report_delete
BEFORE DELETE ON ops."FundingReport"
FOR EACH ROW
EXECUTE FUNCTION ops.prevent_funding_history_delete();

DROP TRIGGER IF EXISTS prevent_funding_report_truncate ON ops."FundingReport";
CREATE TRIGGER prevent_funding_report_truncate
BEFORE TRUNCATE ON ops."FundingReport"
FOR EACH STATEMENT
EXECUTE FUNCTION ops.prevent_funding_history_delete();

DROP TRIGGER IF EXISTS prevent_refund_request_delete ON ops."RefundRequest";
CREATE TRIGGER prevent_refund_request_delete
BEFORE DELETE ON ops."RefundRequest"
FOR EACH ROW
EXECUTE FUNCTION ops.prevent_funding_history_delete();

DROP TRIGGER IF EXISTS prevent_refund_request_truncate ON ops."RefundRequest";
CREATE TRIGGER prevent_refund_request_truncate
BEFORE TRUNCATE ON ops."RefundRequest"
FOR EACH STATEMENT
EXECUTE FUNCTION ops.prevent_funding_history_delete();
