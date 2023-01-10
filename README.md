# Sync GitHub issues and PRs to Azure DevOps work items

Create a work item in Azure DevOps when a GitHub issue or PR is interacted with.

Use the `issues` or `pull_requests` trigger in your workflow to call this action.

## Inputs

### `label`

**Optional**. If specified, only issues or PRs with this label will create ADO items.

### `ado_organization`

The name of the ADO organization where work items are to be created.

### `ado_project`

The name of the ADO project within the organization.

### `ado_tags`

**Optional** tags to be added to the work item (separated by semi-colons).

### `parent_work_item`

**Optional** work item number to parent the newly created work item.

### `ado_area_path`

An area path to put the work item under.

### `ado_work_item_type`

**Optional**. The type of work item to create. Defaults to Bug.

Common values: Task, Bug, Deliverable, Scenario.

### `ado_dont_check_if_exist`

**Optional**. By default, the action tries to find an ADO work item that was already created for this issue or PR. If one is found, no new work item is created.

Set this to true to avoid checking and just always create a work item instead.

## Outputs

### `id`

The id of the Work Item created or updated

## Environment variables

The following environment variables need to be provided to the action:

* `ado_token`: an [Azure Personal Access Token](https://docs.microsoft.com/azure/devops/organizations/accounts/use-personal-access-tokens-to-authenticate) with "read & write" permission for Work Item.
* `github_token`: a GitHub Personal Access Token with "repo" permissions.

## Example usage

```yaml
name: Sync issue to Azure DevOps work item

on:
  issues:
    types:
      [labeled]

jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - uses: captainbrosset/github-actions-issue-to-work-item@patrick
        env:
          ado_token: "${{ secrets.ADO_PERSONAL_ACCESS_TOKEN }}"
          github_token: "${{ secrets.GH_PERSONAL_ACCESS_TOKEN }}"
        with:
          label: 'tracked'
          ado_organization: 'ado_organization_name'
          ado_project: 'your_project_name'
          ado_tags: 'githubSync'
          parent_work_item: 123456789
          ado_area_path: 'optional_area_path'
```
