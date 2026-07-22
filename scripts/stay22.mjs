export const STAY22_AID='hotelio';
export const STAY22_CAMPAIGN='hotelio_search';

export function monetizeStay22Url(value,{aid=STAY22_AID,campaign=STAY22_CAMPAIGN}={}){
  if(!value)return '';
  try{
    const url=new URL(value);
    if(!/(^|\.)stay22\.com$/i.test(url.hostname))return value;
    url.searchParams.set('aid',aid);
    url.searchParams.set('campaign',campaign);
    return url.href;
  }catch{
    return value;
  }
}
