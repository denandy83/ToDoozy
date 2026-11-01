import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
export const labelId = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const id = labelId
export async function makeLabelAuthorizationDatabase(): Promise<PGlite> {
  const db = new PGlite()
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$SELECT current_setting('request.jwt.claim.role',true)$$;
    GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role;
    CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE TABLE projects(id uuid PRIMARY KEY,owner_id uuid);
    CREATE TABLE project_members(project_id uuid,user_id uuid,role text,PRIMARY KEY(project_id,user_id));
    CREATE TABLE tasks(id uuid PRIMARY KEY,project_id uuid REFERENCES projects(id),deleted_at timestamptz,updated_at timestamptz DEFAULT now());
    CREATE TABLE user_labels(id uuid PRIMARY KEY,user_id uuid REFERENCES auth.users(id),name text,color text,order_index integer DEFAULT 0,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),deleted_at timestamptz);
    CREATE TABLE project_labels(project_id uuid REFERENCES projects(id) ON DELETE CASCADE,label_id uuid REFERENCES user_labels(id) ON DELETE CASCADE,created_at timestamptz DEFAULT now(),deleted_at timestamptz,PRIMARY KEY(project_id,label_id));
    CREATE TABLE task_labels(task_id uuid REFERENCES tasks(id) ON DELETE CASCADE,label_id uuid,deleted_at timestamptz,PRIMARY KEY(task_id,label_id));
    ALTER TABLE project_members ENABLE ROW LEVEL SECURITY;
    CREATE POLICY own_membership ON project_members FOR SELECT USING(user_id=auth.uid());
    ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
    CREATE POLICY member_task ON tasks FOR ALL USING(EXISTS(SELECT 1 FROM project_members m WHERE m.project_id=tasks.project_id AND m.user_id=auth.uid()));
    ALTER TABLE user_labels ENABLE ROW LEVEL SECURITY;
    ALTER TABLE project_labels ENABLE ROW LEVEL SECURITY;
    ALTER TABLE task_labels ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "Members can manage project labels" ON project_labels FOR ALL TO authenticated USING(EXISTS(SELECT 1 FROM project_members pm WHERE pm.project_id=project_labels.project_id AND pm.user_id=auth.uid()));
    CREATE POLICY "Service role can manage all project labels" ON project_labels FOR ALL TO service_role USING(auth.role()='service_role');
    CREATE POLICY "Members can manage task labels" ON task_labels FOR ALL USING(EXISTS(SELECT 1 FROM project_members pm JOIN tasks t ON t.project_id=pm.project_id WHERE t.id=task_labels.task_id AND pm.user_id=auth.uid()));
    CREATE POLICY "Service role can manage all task labels" ON task_labels FOR ALL USING(auth.role()='service_role');
    CREATE POLICY "Users can manage own labels" ON user_labels FOR ALL USING(user_id=auth.uid());
    CREATE POLICY "Service role can manage all labels" ON user_labels FOR ALL USING(auth.role()='service_role');
    CREATE POLICY user_labels_read_via_shared_junctions ON user_labels FOR SELECT USING(
      EXISTS(SELECT 1 FROM task_labels tl JOIN tasks t ON t.id=tl.task_id JOIN project_members pm ON pm.project_id=t.project_id WHERE tl.label_id=user_labels.id AND pm.user_id=auth.uid())
      OR EXISTS(SELECT 1 FROM project_labels pl JOIN project_members pm ON pm.project_id=pl.project_id WHERE pl.label_id=user_labels.id AND pm.user_id=auth.uid()));
    GRANT SELECT ON project_members TO authenticated;
    GRANT SELECT,UPDATE ON tasks TO authenticated;
    GRANT SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER ON user_labels,project_labels,task_labels TO authenticated;
    GRANT SELECT,INSERT,UPDATE,DELETE ON user_labels,project_labels,task_labels TO service_role;
    INSERT INTO auth.users VALUES('${id(1)}'),('${id(2)}'),('${id(3)}');
    INSERT INTO projects VALUES('${id(10)}','${id(1)}'),('${id(11)}','${id(2)}'),('${id(12)}','${id(1)}');
    INSERT INTO project_members VALUES('${id(10)}','${id(1)}','owner'),('${id(10)}','${id(3)}','member'),('${id(11)}','${id(2)}','owner'),('${id(12)}','${id(1)}','owner');
    INSERT INTO tasks(id,project_id,deleted_at) VALUES('${id(20)}','${id(10)}',null),('${id(21)}','${id(11)}',null),('${id(22)}','${id(12)}',null);
    INSERT INTO user_labels(id,user_id,name,color,deleted_at) VALUES('${id(80)}','${id(2)}','PRIVATE A','#123456',null),('${id(81)}','${id(2)}','PRIVATE B','#654321',null),('${id(90)}','${id(1)}','OWN','#111111',null),('${id(91)}','${id(2)}','SHARED','#222222',null);
    INSERT INTO project_labels(project_id,label_id) VALUES('${id(11)}','${id(80)}'),('${id(11)}','${id(81)}'),('${id(10)}','${id(91)}');`)
  await db.exec(readFileSync(new URL('../supabase/migrations/20261030052324_task_label_addition_realtime.sql',import.meta.url),'utf8'))
  await db.exec(readFileSync(new URL('../supabase/migrations/20261026075319_shared_label_realtime.sql',import.meta.url),'utf8').split('DO $$')[0])
  return db
}
