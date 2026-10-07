import {guard,requireValue as need,once,finish,digest} from './guard.mjs';
export const ACTIONS=['compliance.review','compliance.decision.record','compliance.exception.record','compliance.hold.record','compliance.retention.resolve'];
export const initialState=()=>({schema:'dev.woia.compliance-state/v1',records:[],operations:[],history:[]});
export function transition(input,command,context){
 guard(command,context,ACTIONS);need(context.department==='legal-compliance','LEGAL_COMPLIANCE_ONLY');
 const policy=context.accepted_policy;need(policy?.accepted===true&&policy.version===context.policy_version&&policy.organization===command.organization&&policy.resource===command.resource&&policy.purposes.includes(command.purpose),'ACCEPTED_APPLICABLE_POLICY_REQUIRED');
 const state=structuredClone(input);const repeated=once(state,command);if(repeated)return {state,result:repeated};const {action,payload:p}=command;need(p&&Array.isArray(p.evidence_refs)&&p.evidence_refs.length&&p.evidence_refs.every(x=>typeof x==='string'&&x),'ATTRIBUTABLE_EVIDENCE_REQUIRED');
 if(action==='compliance.review'){
  need(Array.isArray(policy.criteria)&&policy.criteria.length&&policy.criteria.every(c=>c.id&&Array.isArray(c.allowed_values)),'ACCEPTED_REVIEW_CRITERIA_REQUIRED');
  const checks=policy.criteria.map(c=>({criterion:c.id,result:Object.hasOwn(p.facts??{},c.id)?(c.allowed_values.includes(p.facts[c.id])?'SATISFIED':'NOT_SATISFIED'):'UNKNOWN'}));
  const result={status:checks.some(x=>x.result==='UNKNOWN')?'INSUFFICIENT_EVIDENCE':checks.every(x=>x.result==='SATISFIED')?'POLICY_MATCH':'POLICY_MISMATCH',checks,legal_opinion:false,policy_version:policy.version};state.records.push({id:command.operation_id,organization:command.organization,resource:command.resource,action,result,evidence_refs:p.evidence_refs,policy_version:policy.version});return finish(state,command,result);
 }
 if(action==='compliance.retention.resolve'){
  const holds=state.records.filter(x=>x.organization===command.organization&&x.resource===command.resource&&x.action==='compliance.hold.record');
  if(holds.length)return finish(state,command,{disposal:'BLOCKED_HOLD',hold_ids:holds.map(h=>h.id)});
  need(policy.retention&&Number.isFinite(policy.retention.retain_until),'RETENTION_RULE_REQUIRED');return finish(state,command,{disposal:context.now>=policy.retention.retain_until&&policy.retention.disposal_permitted===true?'ELIGIBLE_REQUIRES_DOCUMENT_DISPOSAL_AUTHORITY':'RETAIN',policy_version:policy.version});
 }
 const decision=context.competent_decision;need(decision?.accepted===true&&decision.actor&&decision.evidence_ref&&decision.command_digest===digest(command)&&decision.policy_version===policy.version,'COMPETENT_EXACT_DECISION_REQUIRED');
 need(p.reason&&p.record_id&&!state.records.some(x=>x.organization===command.organization&&x.id===p.record_id),'IMMUTABLE_UNIQUE_RECORD_REQUIRED');
 if(action==='compliance.exception.record')need(p.rule_id&&policy.criteria?.some(c=>c.id===p.rule_id)&&policy.exception_rules?.includes(p.rule_id),'AUTHORIZED_EXCEPTION_RULE_REQUIRED');
 if(action==='compliance.hold.record')need(p.hold_scope===command.resource,'EXACT_HOLD_SCOPE_REQUIRED');
 if(action==='compliance.decision.record')need(p.outcome&&policy.allowed_decisions?.includes(p.outcome),'POLICY_DECISION_OUTCOME_REQUIRED');
 state.records.push({id:p.record_id,organization:command.organization,resource:command.resource,action,reason:p.reason,evidence_refs:p.evidence_refs,policy_version:policy.version,decision:structuredClone(decision),payload:structuredClone(p)});
 return finish(state,command,{status:'RECORDED',record_id:p.record_id,legal_opinion:false});
}
