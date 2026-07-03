export interface Member {
  id: string
  email: string
  displayName: string
}

export const buildMemberLabel = (member: Member): string => {
  return `${member.displayName} <${member.email}>`
}
